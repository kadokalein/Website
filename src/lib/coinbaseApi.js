// Coinbase Advanced Trade API — supports both key types:
//   • New CDP keys (Ed25519 JWT) — algorithm shown as "Ed25519" on coinbase.com
//   • Legacy keys (HMAC-SHA256) — older format from Coinbase Pro
//
// Keys are read from the caller and never sent to any server except api.coinbase.com.

const BASE = 'https://api.coinbase.com/api/v3/brokerage';
const COINBASE_HOST = 'api.coinbase.com';

// ── Base64url helpers ──────────────────────────────────────────────────────────
function b64url(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlBytes(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// ── DER encoding helpers (for SEC1 → PKCS8 conversion) ───────────────────────

function derLen(n) {
  if (n < 0x80) return new Uint8Array([n]);
  if (n < 0x100) return new Uint8Array([0x81, n]);
  return new Uint8Array([0x82, (n >> 8) & 0xff, n & 0xff]);
}
function derTLV(tag, value) {
  const l = derLen(value.length);
  const out = new Uint8Array(1 + l.length + value.length);
  out[0] = tag; out.set(l, 1); out.set(value, 1 + l.length);
  return out;
}
function derSeq(...parts) {
  const body = parts.reduce((a, b) => { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; }, new Uint8Array(0));
  return derTLV(0x30, body);
}

// OIDs for key type detection and PKCS8 wrapping
const OID_P256_BYTES    = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]; // 1.2.840.10045.3.1.7
const OID_ED25519_BYTES = [0x2b, 0x65, 0x70];                                 // 1.3.101.112
const OID_EC_PUBKEY = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
const OID_P256      = new Uint8Array([0x06, 0x08, ...OID_P256_BYTES]);

// Detect whether a DER blob is P-256 (ES256) or Ed25519 (EdDSA)
function detectKeyAlg(der) {
  const p256 = OID_P256_BYTES;
  const ed25519 = OID_ED25519_BYTES;
  outer: for (let i = 0; i < der.length - p256.length; i++) {
    for (let j = 0; j < p256.length; j++) { if (der[i + j] !== p256[j]) continue outer; }
    return 'ES256';
  }
  outer2: for (let i = 0; i < der.length - ed25519.length; i++) {
    for (let j = 0; j < ed25519.length; j++) { if (der[i + j] !== ed25519[j]) continue outer2; }
    return 'EdDSA';
  }
  return 'ES256'; // default to P-256 (Coinbase CDP standard)
}

// Parse DER length field → { len, bytesRead }
function derReadLen(buf, pos) {
  const first = buf[pos];
  if (first < 0x80) return { len: first, bytesRead: 1 };
  const n = first & 0x7f;
  let len = 0;
  for (let i = 1; i <= n; i++) len = (len << 8) | buf[pos + i];
  return { len, bytesRead: 1 + n };
}

// Extract the raw private key bytes from SEC1 "EC PRIVATE KEY" DER blob
function extractSec1PrivKey(der) {
  let pos = 0;
  if (der[pos++] !== 0x30) throw new Error('Expected SEQUENCE');
  const seqL = derReadLen(der, pos); pos += seqL.bytesRead;
  // Skip version INTEGER (02 01 01)
  if (der[pos++] !== 0x02) throw new Error('Expected INTEGER');
  const intL = derReadLen(der, pos); pos += intL.bytesRead + intL.len;
  // Read privateKey OCTET STRING
  if (der[pos++] !== 0x04) throw new Error('Expected OCTET STRING');
  const keyL = derReadLen(der, pos); pos += keyL.bytesRead;
  return der.slice(pos, pos + keyL.len);
}

// Import a PEM private key; returns { key: CryptoKey, alg: 'ES256' | 'EdDSA' }
async function importPrivateKey(pem) {
  const normalized = pem.replace(/\\n/g, '\n').replace(/\\r/g, '');
  const b64 = normalized
    .replace(/-----BEGIN (?:EC |)PRIVATE KEY-----|-----END (?:EC |)PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  const alg = detectKeyAlg(der);

  if (alg === 'ES256') {
    // Try importing as PKCS8 directly first (some tools export it that way)
    try {
      const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
      return { key, alg };
    } catch { /* */ }

    // SEC1 → PKCS8: wrap the SEC1 blob in a PKCS8 AlgorithmIdentifier envelope
    try {
      const privBytes = extractSec1PrivKey(der);
      const innerOctet = derTLV(0x04, privBytes);
      const algId = derSeq(OID_EC_PUBKEY, OID_P256);
      const pkcs8 = derSeq(new Uint8Array([0x02, 0x01, 0x00]), algId, derTLV(0x04, innerOctet));
      const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
      return { key, alg };
    } catch { /* */ }

    // Last resort: treat raw 32-byte payload as the private scalar and rewrap
    try {
      const raw = der.slice(-32);
      const innerOctet = derTLV(0x04, raw);
      const algId = derSeq(OID_EC_PUBKEY, OID_P256);
      const pkcs8 = derSeq(new Uint8Array([0x02, 0x01, 0x00]), algId, derTLV(0x04, innerOctet));
      const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
      return { key, alg };
    } catch { /* */ }
  }

  // EdDSA path (fallback / legacy keys)
  const PKCS8_ED_PREFIX = new Uint8Array([
    0x30,0x2e, 0x02,0x01,0x00, 0x30,0x05, 0x06,0x03,0x2b,0x65,0x70, 0x04,0x22, 0x04,0x20,
  ]);
  function wrapEdSeed(seed) {
    const p = new Uint8Array(PKCS8_ED_PREFIX.length + seed.length);
    p.set(PKCS8_ED_PREFIX); p.set(seed, PKCS8_ED_PREFIX.length);
    return p;
  }
  try {
    const key = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
    return { key, alg: 'EdDSA' };
  } catch { /* */ }
  try {
    const seed = extractSec1PrivKey(der);
    const key = await crypto.subtle.importKey('pkcs8', wrapEdSeed(seed), { name: 'Ed25519' }, false, ['sign']);
    return { key, alg: 'EdDSA' };
  } catch { /* */ }
  try {
    const seed = der.slice(-32);
    const key = await crypto.subtle.importKey('pkcs8', wrapEdSeed(seed), { name: 'Ed25519' }, false, ['sign']);
    return { key, alg: 'EdDSA' };
  } catch { /* */ }

  throw new Error('Could not import private key. Make sure you pasted the full PEM from the downloaded JSON file.');
}

// makeJWT: nonce goes in the JWT header (Coinbase requirement), uri uses full API path
async function makeJWT(keyName, privatePEM, method, apiPath) {
  const { key, alg } = await importPrivateKey(privatePEM);
  const now   = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID?.() ??
    crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');

  const header  = b64url({ alg, typ: 'JWT', kid: keyName, nonce });
  const payload = b64url({
    sub: keyName,
    iss: 'coinbase-cloud',
    nbf: now,
    exp: now + 120,
    uri: `${method} ${COINBASE_HOST}${apiPath}`,
  });
  const msg = `${header}.${payload}`;

  let sig;
  if (alg === 'ES256') {
    // ECDSA with P-256 produces DER-encoded signature; Coinbase expects raw R||S (64 bytes)
    const derSig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(msg)));
    // Convert DER SEQUENCE { r INTEGER, s INTEGER } → 32-byte R || 32-byte S
    let pos = 2; // skip 0x30 <len>
    const rLen = derSig[pos + 1]; const r = derSig.slice(pos + 2, pos + 2 + rLen); pos += 2 + rLen;
    const sLen = derSig[pos + 1]; const s = derSig.slice(pos + 2, pos + 2 + sLen);
    const raw = new Uint8Array(64);
    raw.set(r.length > 32 ? r.slice(r.length - 32) : r, 32 - Math.min(r.length, 32));
    raw.set(s.length > 32 ? s.slice(s.length - 32) : s, 64 - Math.min(s.length, 32));
    sig = raw;
  } else {
    sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(msg)));
  }
  return `${msg}.${b64urlBytes(sig)}`;
}

// ── HMAC-SHA256 signing (legacy keys) ─────────────────────────────────────────
async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Detect key type ────────────────────────────────────────────────────────────
// CDP (Ed25519) private keys are PEM-encoded; legacy secrets are hex/base64 strings.
export function isEdKey(secret) {
  return typeof secret === 'string' && secret.trim().startsWith('-----BEGIN');
}

// ── Core request ──────────────────────────────────────────────────────────────
async function req(apiKey, apiSecret, method, path, body = null, params = null, baseUrl = BASE) {
  const bodyStr = body ? JSON.stringify(body) : '';
  let url = baseUrl + path;
  if (params) url += '?' + new URLSearchParams(params).toString();

  let headers;
  if (isEdKey(apiSecret)) {
    // JWT uri must use the full path as it appears on api.coinbase.com, not just the suffix
    const apiPath = new URL(url.startsWith('http') ? url : `https://api.coinbase.com${url}`).pathname;
    const jwt = await makeJWT(apiKey, apiSecret, method, apiPath);
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` };
  } else {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = await hmacSign(apiSecret, timestamp + method + path + bodyStr);
    headers = {
      'Content-Type': 'application/json',
      'CB-ACCESS-KEY': apiKey,
      'CB-ACCESS-SIGN': sig,
      'CB-ACCESS-TIMESTAMP': timestamp,
    };
  }

  const res  = await fetch(url, { method, headers, body: body ? bodyStr : undefined });
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch { /* */ }
  if (!res.ok) {
    const msg = json?.message ?? json?.error_details ?? json?.error ?? json?.preview_failure_reason
      ?? (text ? `HTTP ${res.status}: ${text.slice(0, 200)}` : `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return json;
}

// ── Public client ──────────────────────────────────────────────────────────────
// proxyBase: optional string like 'http://localhost:8080' to route through a local CORS proxy.
// When set, requests go to proxyBase/api/v3/brokerage/... instead of api.coinbase.com/...
export function createCoinbaseClient(apiKey, apiSecret, proxyBase = null) {
  const baseUrl = proxyBase ? `${proxyBase}/api/v3/brokerage` : BASE;
  const r = (m, p, b, q) => req(apiKey, apiSecret, m, p, b, q, baseUrl);
  return {
    getAccounts:     ()                                    => r('GET',  '/accounts'),
    placeMarketBuy:  (clientOrderId, productId, quoteSize) =>
      r('POST', '/orders', { client_order_id: clientOrderId, product_id: productId, side: 'BUY',
        order_configuration: { market_market_ioc: { quote_size: String(quoteSize) } } }),
    placeMarketSell: (clientOrderId, productId, baseSize) =>
      r('POST', '/orders', { client_order_id: clientOrderId, product_id: productId, side: 'SELL',
        order_configuration: { market_market_ioc: { base_size: String(baseSize) } } }),
    placeLimitOrder: (clientOrderId, productId, side, baseSize, limitPrice) =>
      r('POST', '/orders', { client_order_id: clientOrderId, product_id: productId, side,
        order_configuration: { limit_limit_gtc: { base_size: String(baseSize), limit_price: String(limitPrice) } } }),
    cancelOrder:     (orderId) => r('POST', '/orders/cancel', { order_ids: [orderId] }),
    listOrders:      (params = {}) => r('GET', '/orders/historical/batch', null, params),
    getBestBidAsk:   (productIds) => r('GET', '/best_bid_ask', null, { product_ids: productIds }),
  };
}

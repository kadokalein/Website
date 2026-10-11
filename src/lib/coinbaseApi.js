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

// ── Ed25519 JWT signing (new CDP keys) ────────────────────────────────────────

// Parse a DER length field; returns { len, bytesRead }
function derReadLen(buf, pos) {
  const first = buf[pos];
  if (first < 0x80) return { len: first, bytesRead: 1 };
  const n = first & 0x7f;
  let len = 0;
  for (let i = 1; i <= n; i++) len = (len << 8) | buf[pos + i];
  return { len, bytesRead: 1 + n };
}

// Extract the raw 32-byte Ed25519 seed from a SEC1 "EC PRIVATE KEY" DER blob.
// SEC1 ECPrivateKey ::= SEQUENCE { version INTEGER, privateKey OCTET STRING, ... }
function extractSec1Seed(der) {
  let pos = 0;
  if (der[pos++] !== 0x30) throw new Error('Expected SEQUENCE');
  const seqLen = derReadLen(der, pos); pos += seqLen.bytesRead + seqLen.len; // skip past entire seq to rewind
  pos = 1 + derReadLen(der, 1).bytesRead; // rewind: just past the top SEQUENCE length
  // Skip version INTEGER
  if (der[pos++] !== 0x02) throw new Error('Expected INTEGER');
  const intLen = derReadLen(der, pos); pos += intLen.bytesRead + intLen.len;
  // Read privateKey OCTET STRING
  if (der[pos++] !== 0x04) throw new Error('Expected OCTET STRING');
  const keyLen = derReadLen(der, pos); pos += keyLen.bytesRead;
  return der.slice(pos, pos + keyLen.len);
}

async function importEd25519(pem) {
  // Normalize: handle literal \n strings (from JSON copy-paste), real newlines, Windows CRLF
  const normalized = pem.replace(/\\n/g, '\n').replace(/\\r/g, '');
  const b64 = normalized
    .replace(/-----BEGIN (?:EC |)PRIVATE KEY-----|-----END (?:EC |)PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  // Ed25519 PKCS#8 wrapper: wraps a 32-byte raw seed in the standard PKCS#8 DER envelope
  const PKCS8_PREFIX = new Uint8Array([
    0x30,0x2e, // SEQUENCE (46 bytes)
      0x02,0x01,0x00, // INTEGER version=0
      0x30,0x05,      // SEQUENCE (5 bytes) — AlgorithmIdentifier
        0x06,0x03,0x2b,0x65,0x70, // OID 1.3.101.112 = Ed25519
      0x04,0x22,      // OCTET STRING (34 bytes)
        0x04,0x20,    // OCTET STRING (32 bytes) = the seed
  ]);
  function wrapSeed(seed) {
    const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + seed.length);
    pkcs8.set(PKCS8_PREFIX); pkcs8.set(seed, PKCS8_PREFIX.length);
    return pkcs8;
  }

  // 1. Try raw PKCS#8 (standard "PRIVATE KEY" header, already in correct format)
  try {
    return await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
  } catch { /* */ }

  // 2. Coinbase CDP gives "EC PRIVATE KEY" (SEC1 format). Parse the DER properly
  //    to extract the 32-byte seed from the OCTET STRING field.
  try {
    const seed = extractSec1Seed(der);
    return await crypto.subtle.importKey('pkcs8', wrapSeed(seed), { name: 'Ed25519' }, false, ['sign']);
  } catch { /* */ }

  // 3. Last resort: take the last 32 bytes (works when SEC1 has no trailing OID/pubkey)
  try {
    const seed = der.slice(-32);
    return await crypto.subtle.importKey('pkcs8', wrapSeed(seed), { name: 'Ed25519' }, false, ['sign']);
  } catch { /* */ }

  throw new Error('Could not import private key. Make sure you pasted the full PEM from the downloaded JSON file.');
}

async function makeJWT(keyName, privatePEM, method, path) {
  const key    = await importEd25519(privatePEM);
  const header = b64url({ alg: 'EdDSA', kid: keyName });
  const now    = Math.floor(Date.now() / 1000);
  const nonce  = crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
  const payload = b64url({
    sub: keyName, iss: 'cdp', nbf: now, exp: now + 120,
    nonce,
    uri: `${method} api.coinbase.com${path}`,
  });
  const msg = `${header}.${payload}`;
  const sig = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(msg));
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
    const jwt = await makeJWT(apiKey, apiSecret, method, path);
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

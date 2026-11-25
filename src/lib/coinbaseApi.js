// Coinbase Advanced Trade API client (signed REST calls).
//
// Supported key types — detectKeyType() tells them apart:
//   • 'ed25519' — CDP key, the default for new keys. Downloaded JSON: {"id", "privateKey"} where
//                 privateKey is base64 of 64 bytes (32-byte seed + 32-byte public key). A 32-byte
//                 seed or a PKCS8 "BEGIN PRIVATE KEY" Ed25519 PEM also work.          → EdDSA JWT
//   • 'ecdsa'   — CDP key with the ECDSA algorithm. Downloaded JSON: {"name": "organizations/…/apiKeys/…",
//                 "privateKey": "-----BEGIN EC PRIVATE KEY-----…"} (SEC1), or a PKCS8 P-256 PEM. → ES256 JWT
//   • 'hmac'    — legacy key: anything that is neither a PEM nor base64 of 32/64 bytes. → CB-ACCESS-* headers
//
// The JWT follows Coinbase's Advanced Trade SDKs (coinbase-advanced-py, advanced-trade-sdk-ts):
//   header  { alg, kid: <key name/id>, nonce: <random hex>, typ: 'JWT' }
//   payload { sub: <key name/id>, iss: 'cdp', nbf, exp: nbf + 120, uri: 'GET api.coinbase.com/api/v3/brokerage/…' }
//
// Keys are read from the caller and only ever sent to api.coinbase.com (directly, or through the
// user's own localhost proxy, which forwards to api.coinbase.com).

import { PROXY_URL } from './coinbaseKeys.js';

const API_HOST = 'api.coinbase.com';
const API_ORIGIN = `https://${API_HOST}`;
const API_PREFIX = '/api/v3/brokerage';

const enc = new TextEncoder();

// ── Encoding helpers ──────────────────────────────────────────────────────────
function bytesToB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function bytesToB64url(bytes) {
  return bytesToB64(bytes).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function jsonToB64url(obj) {
  return bytesToB64url(enc.encode(JSON.stringify(obj)));
}
// Strict base64 / base64url decode → Uint8Array, or null when the text is not base64.
function b64ToBytes(text) {
  const s = String(text).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!s || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const bare = s.replace(/=+$/, '');
  if (bare.length % 4 === 1) return null;
  try {
    const bin = atob(bare + '='.repeat((4 - (bare.length % 4)) % 4));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  } catch {
    return null;
  }
}
function randomHex(nBytes) {
  const b = crypto.getRandomValues(new Uint8Array(nBytes));
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function bytesEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ── Minimal DER reader / writer ───────────────────────────────────────────────
function derNode(buf, pos) {
  if (pos + 2 > buf.length) throw new Error('Truncated DER');
  const tag = buf[pos];
  let p = pos + 1;
  let len = buf[p++];
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 3) throw new Error('Bad DER length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[p++];
  }
  if (p + len > buf.length) throw new Error('Truncated DER');
  return { tag, start: p, end: p + len };
}
function derChildren(buf, node) {
  const out = [];
  for (let p = node.start; p < node.end;) { const c = derNode(buf, p); out.push(c); p = c.end; }
  return out;
}
function derTLV(tag, value) {
  const n = value.length;
  const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return concatBytes(new Uint8Array([tag, ...len]), value);
}

const OID_EC_PUBLIC_KEY = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);       // 1.2.840.10045.2.1
const OID_P256          = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]); // 1.2.840.10045.3.1.7
const OID_ED25519       = new Uint8Array([0x2b, 0x65, 0x70]);                               // 1.3.101.112
// PKCS8 PrivateKeyInfo prefix for an Ed25519 key; append the 32-byte seed.
const ED25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

function parsePem(text) {
  const m = text.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) return null;
  const der = b64ToBytes(m[2]);
  return der ? { label: m[1], der } : null;
}

// PKCS8 → 'ecdsa' | 'ed25519' | null
function pkcs8KeyType(der) {
  try {
    const top = derChildren(der, derNode(der, 0));
    const algId = derChildren(der, top[1]);
    const oid = der.slice(algId[0].start, algId[0].end);
    if (bytesEqual(oid, OID_ED25519)) return 'ed25519';
    if (bytesEqual(oid, OID_EC_PUBLIC_KEY)) return 'ecdsa';
  } catch { /* not PKCS8 */ }
  return null;
}

// ── Key handling ──────────────────────────────────────────────────────────────

// Tidy a pasted private key: trim, drop wrapping quotes, turn literal "\n" sequences into newlines.
export function normalizeSecret(secret) {
  if (typeof secret !== 'string') return '';
  let s = secret.trim();
  if (s.length >= 2 && /^(["']).*\1$/s.test(s)) s = s.slice(1, -1).trim();
  return s.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '').trim();
}
// Tidy a pasted key name / id.
export function normalizeKeyName(name) {
  if (typeof name !== 'string') return '';
  let s = name.trim();
  if (s.length >= 2 && /^(["']).*\1$/s.test(s)) s = s.slice(1, -1).trim();
  return s;
}

// → 'ecdsa' | 'ed25519' | 'hmac' | null (null = empty, or a PEM that is not a usable key)
export function detectKeyType(secret) {
  const s = normalizeSecret(secret);
  if (!s) return null;
  if (s.includes('-----BEGIN')) {
    const pem = parsePem(s);
    if (!pem) return null;
    if (pem.label === 'EC PRIVATE KEY') return 'ecdsa';
    if (pem.label === 'PRIVATE KEY') return pkcs8KeyType(pem.der);
    return null;
  }
  const raw = b64ToBytes(s);
  if (raw && (raw.length === 32 || raw.length === 64)) return 'ed25519';
  return 'hmac';
}

export const KEY_TYPE_LABELS = {
  ed25519: 'Ed25519 (CDP)',
  ecdsa: 'ECDSA P-256 (CDP)',
  hmac: 'Legacy HMAC',
};
export function keyTypeLabel(type) {
  return KEY_TYPE_LABELS[type] ?? 'Unrecognised key';
}

async function importEcdsa(pem) {
  const algo = { name: 'ECDSA', namedCurve: 'P-256' };
  if (pem.label === 'PRIVATE KEY') return crypto.subtle.importKey('pkcs8', pem.der, algo, false, ['sign']);

  // SEC1 "EC PRIVATE KEY" (what Coinbase hands out): import as JWK, which every browser supports.
  const top = derNode(pem.der, 0);
  const kids = derChildren(pem.der, top);
  if (kids.length < 2 || kids[1].tag !== 0x04) throw new Error('Not an EC private key');
  const d = pem.der.slice(kids[1].start, kids[1].end);
  let curve = null, pub = null;
  for (const k of kids.slice(2)) {
    const inner = derNode(pem.der, k.start);
    if (k.tag === 0xa0 && inner.tag === 0x06) curve = pem.der.slice(inner.start, inner.end);
    if (k.tag === 0xa1 && inner.tag === 0x03) pub = pem.der.slice(inner.start + 1, inner.end);
  }
  if (curve && !bytesEqual(curve, OID_P256)) throw new Error('This EC key is not on the P-256 curve');
  if (d.length <= 32 && pub?.length === 65 && pub[0] === 0x04) {
    const dd = concatBytes(new Uint8Array(32 - d.length), d);
    const jwk = {
      kty: 'EC', crv: 'P-256', ext: true,
      d: bytesToB64url(dd), x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33)),
    };
    try { return await crypto.subtle.importKey('jwk', jwk, algo, false, ['sign']); } catch { /* try PKCS8 below */ }
  }
  // Fallback: wrap the SEC1 blob in a PKCS8 PrivateKeyInfo.
  const algId = derTLV(0x30, concatBytes(derTLV(0x06, OID_EC_PUBLIC_KEY), derTLV(0x06, OID_P256)));
  const pkcs8 = derTLV(0x30, concatBytes(new Uint8Array([0x02, 0x01, 0x00]), algId, derTLV(0x04, pem.der)));
  return crypto.subtle.importKey('pkcs8', pkcs8, algo, false, ['sign']);
}

async function importEd25519(secret) {
  const pem = secret.includes('-----BEGIN') ? parsePem(secret) : null;
  const der = pem ? pem.der : concatBytes(ED25519_PKCS8_PREFIX, b64ToBytes(secret).slice(0, 32));
  return crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
}

const keyCache = new Map(); // normalised secret → Promise<{ key, alg }>

async function importSigningKey(secret, type) {
  const cached = keyCache.get(secret);
  if (cached) return cached;
  const p = (async () => {
    try {
      if (type === 'ecdsa') return { key: await importEcdsa(parsePem(secret)), alg: 'ES256' };
      return { key: await importEd25519(secret), alg: 'EdDSA' };
    } catch (e) {
      const hint = type === 'ed25519'
        ? 'This browser could not load the Ed25519 key — update the browser (Chrome 137+, Firefox 129+, Safari 17+), or re-copy the privateKey from the downloaded file.'
        : 'Paste the whole privateKey from the downloaded file, including the -----BEGIN … KEY----- and -----END … KEY----- lines.';
      throw new CoinbaseError('key_invalid', `Could not load the ${keyTypeLabel(type)} private key. ${hint}`, { detail: e?.message });
    }
  })();
  if (keyCache.size > 4) keyCache.clear();
  keyCache.set(secret, p);
  p.catch(() => keyCache.delete(secret));
  return p;
}

// Builds the Bearer JWT for one request. fullPath is the path on api.coinbase.com without the
// query string, e.g. '/api/v3/brokerage/accounts'.
export async function makeJWT(keyName, privateKey, method, fullPath) {
  const secret = normalizeSecret(privateKey);
  const type = detectKeyType(secret);
  if (type !== 'ecdsa' && type !== 'ed25519') throw new CoinbaseError('key_invalid', 'Not a CDP private key.');
  const { key, alg } = await importSigningKey(secret, type);
  const kid = normalizeKeyName(keyName);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg, kid, nonce: randomHex(16), typ: 'JWT' };
  const payload = { sub: kid, iss: 'cdp', nbf: now, exp: now + 120, uri: `${method} ${API_HOST}${fullPath}` };
  const msg = `${jsonToB64url(header)}.${jsonToB64url(payload)}`;

  let sig;
  if (alg === 'ES256') {
    // WebCrypto returns the raw 64-byte R||S (IEEE P1363) signature that JWS ES256 expects.
    sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(msg)));
  } else {
    sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, enc.encode(msg)));
  }
  return `${msg}.${bytesToB64url(sig)}`;
}

// ── HMAC-SHA256 signing (legacy keys) ─────────────────────────────────────────
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

// Auth headers for one request. fullPath excludes the query string (Coinbase signs the path only).
export async function authHeaders(apiKey, apiSecret, method, fullPath, bodyStr = '') {
  const secret = normalizeSecret(apiSecret);
  const type = detectKeyType(secret);
  if (!type) {
    throw new CoinbaseError('key_invalid',
      'The saved private key is not recognised. Paste the privateKey value from the JSON file Coinbase gave you.');
  }
  if (!normalizeKeyName(apiKey)) throw new CoinbaseError('key_invalid', 'The API key name / id is missing.');
  if (type === 'hmac') {
    const timestamp = String(Math.floor(Date.now() / 1000));
    // Coinbase's legacy signature covers the path only, not the query string.
    const requestPath = fullPath;
    return {
      'Content-Type': 'application/json',
      'CB-ACCESS-KEY': normalizeKeyName(apiKey),
      'CB-ACCESS-SIGN': await hmacHex(secret, timestamp + method + requestPath + bodyStr),
      'CB-ACCESS-TIMESTAMP': timestamp,
    };
  }
  const jwt = await makeJWT(apiKey, secret, method, fullPath);
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` };
}

// ── Errors ────────────────────────────────────────────────────────────────────
// kind: 'proxy_off' | 'proxy_unreachable' | 'proxy_wrong_service' | 'proxy_upstream'
//     | 'auth' | 'http' | 'key_invalid' | 'network'
export class CoinbaseError extends Error {
  constructor(kind, message, { status = null, detail = null } = {}) {
    super(message || kind);
    this.name = 'CoinbaseError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

function coinbaseErrorText(json, text) {
  const parts = [json?.error, json?.message, json?.error_details, json?.preview_failure_reason]
    .filter(v => typeof v === 'string' && v.trim());
  return (parts.length ? parts.join(' · ') : String(text ?? '').trim()).slice(0, 400);
}

// Confirms the local proxy is up and is ours. Throws CoinbaseError otherwise.
export async function checkProxy(proxyUrl = PROXY_URL) {
  let res;
  try {
    res = await fetch(`${proxyUrl}/health`, { cache: 'no-store', signal: timeoutSignal(5000) });
  } catch (e) {
    throw new CoinbaseError('proxy_unreachable', `The local proxy at ${proxyUrl} is not reachable.`, { detail: e?.message });
  }
  const j = await res.json().catch(() => null);
  if (!res.ok || !String(j?.proxy ?? '').includes('coinbase')) {
    throw new CoinbaseError('proxy_wrong_service',
      `Something other than cors-proxy.js is answering at ${proxyUrl}.`, { status: res.status });
  }
  if (!(Number(j.version) >= 2)) {
    throw new CoinbaseError('proxy_outdated', 'Your copy of cors-proxy.js is out of date.', { status: res.status });
  }
  return j;
}

// ── Core request ──────────────────────────────────────────────────────────────
async function req(apiKey, apiSecret, method, path, body, params, origin, proxied) {
  const bodyStr = body ? JSON.stringify(body) : '';
  const query = params ? new URLSearchParams(params).toString() : '';
  const fullPath = API_PREFIX + path;
  const url = origin + fullPath + (query ? `?${query}` : '');
  const headers = await authHeaders(apiKey, apiSecret, method, fullPath, bodyStr);

  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? bodyStr : undefined, signal: timeoutSignal(30_000) });
  } catch (e) {
    if (proxied) {
      throw new CoinbaseError('proxy_unreachable', `Could not reach the local proxy at ${origin}.`, { detail: e?.message });
    }
    // From a web page this is the browser's CORS block: Coinbase refuses signed cross-origin requests.
    throw new CoinbaseError('proxy_off',
      'Coinbase does not accept signed requests straight from a web page. Turn on the local proxy.', { detail: e?.message });
  }
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (res.ok) return json;

  const detail = coinbaseErrorText(json, text);
  if (proxied && json?.error === 'proxy_forbidden_origin') {
    throw new CoinbaseError('proxy_forbidden_origin', 'The local proxy only answers this site at kadokalein.github.io or localhost.', { status: res.status });
  }
  if (proxied && (json?.error === 'proxy_upstream_error' || json?.error === 'proxy_timeout')) {
    throw new CoinbaseError('proxy_upstream',
      `The local proxy is running but could not get an answer from api.coinbase.com (HTTP ${res.status}).`,
      { status: res.status, detail: json.message ?? detail });
  }
  if (res.status === 401 || res.status === 403) {
    throw new CoinbaseError('auth', `Coinbase rejected the API key (HTTP ${res.status})${detail ? `: ${detail}` : ''}`,
      { status: res.status, detail });
  }
  throw new CoinbaseError('http', `Coinbase returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
    { status: res.status, detail });
}

// Turns any error from this client into text the UI can show.
// → { kind, title, summary, steps: string[], detail, status }
export function describeCoinbaseError(err, { keyType = null, proxyUrl = PROXY_URL } = {}) {
  const kind = err instanceof CoinbaseError ? err.kind : 'network';
  const detail = err?.detail ?? (err instanceof CoinbaseError ? null : String(err?.message ?? err));
  const status = err?.status ?? null;
  const startSteps = [
    'Download cors-proxy.js from this page (button below).',
    'Open Terminal (Mac) or Command Prompt (Windows) in the folder you saved it to, and run: node cors-proxy.js — Node.js is free from nodejs.org.',
    'Keep that window open while you use this site.',
    'If Chrome asks to let this site "access other apps and services on this device" or "devices on your local network", click Allow. If you clicked Block before, re-allow it from the icon at the left of the address bar.',
  ];
  switch (kind) {
    case 'proxy_off':
      return { kind, status, detail,
        title: 'Local proxy is switched off',
        summary: 'Coinbase does not accept signed requests straight from a web page. Turn on the local proxy.',
        steps: ['Turn on "Proxy" on the Live page.', ...startSteps] };
    case 'proxy_unreachable':
      return { kind, status, detail,
        title: `Can't reach the local proxy at ${proxyUrl}`,
        summary: `The local proxy is not running or the browser blocked it — run "node cors-proxy.js" and keep the window open; if Chrome asks to allow access to your local network, click Allow.`,
        steps: startSteps };
    case 'proxy_wrong_service':
      return { kind, status, detail,
        title: `Another program is using ${proxyUrl}`,
        summary: `Something other than cors-proxy.js is answering on ${proxyUrl} — close it and run "node cors-proxy.js".`,
        steps: ['Close the other program using port 9999 (or restart the computer).', ...startSteps.slice(1)] };
    case 'proxy_upstream':
      return { kind, status, detail,
        title: 'The proxy is running but could not reach Coinbase',
        summary: `The local proxy could not reach api.coinbase.com${detail ? ` (${detail})` : ''} — check your internet connection and try again.`,
        steps: ['Check this computer\'s internet connection.', 'Look at the proxy window for an error message, then try again.'] };
    case 'proxy_outdated':
      return { kind, status, detail,
        title: 'Your copy of the local proxy is out of date',
        summary: 'Your copy of cors-proxy.js is out of date — download it again from this page, stop the old one (Ctrl+C in its window), and run "node cors-proxy.js".',
        steps: ['Stop the old proxy: click its window and press Ctrl+C.', ...startSteps] };
    case 'proxy_forbidden_origin':
      return { kind, status, detail,
        title: 'The local proxy refused this page',
        summary: 'The local proxy only works with this site opened from https://kadokalein.github.io (or localhost on this computer).',
        steps: ['Open the site at https://kadokalein.github.io/Website/ and try again.'] };
    case 'order_rejected':
      return { kind, status, detail,
        title: 'Coinbase rejected the order',
        summary: err.message,
        steps: ['Nothing was bought or sold. Check the amount, your available balance and the coin, then try again.'] };
    case 'auth': {
      const typeText = keyType ? keyTypeLabel(keyType) : 'unrecognised';
      const steps = [
        `Detected key type: ${typeText}.`,
        'The key needs the "View" permission (and "Trade" to place orders) — check it on the Coinbase Developer Platform API keys page.',
        'If the key has an IP allowlist, Coinbase rejects requests from any other IP address — add this computer\'s public IP, or create a key without an allowlist.',
        'Paste the full key name / id exactly as in the downloaded file: "organizations/…/apiKeys/…" (the "name" field) or the whole "id" value.',
        'This computer\'s clock must be correct — each signed request is only valid for 2 minutes.',
      ];
      if (keyType === 'hmac') steps.push('Legacy keys may no longer work — create a new key on the Coinbase Developer Platform and paste its JSON file.');
      if (keyType === 'ed25519') steps.push('If an Ed25519 key keeps being rejected, create a new key with the ECDSA signature algorithm (under "Advanced settings" when creating the key) and paste that file instead.');
      return { kind, status, detail,
        title: `Coinbase rejected the API key (HTTP ${status})`,
        summary: `Coinbase rejected the ${typeText} API key (HTTP ${status}) — check it has "View" permission, any IP allowlist, and that the full key name/id was pasted.`,
        steps };
    }
    case 'http':
      return { kind, status, detail,
        title: `Coinbase returned HTTP ${status}`,
        summary: `Coinbase returned HTTP ${status}${detail ? `: ${detail}` : ''}`,
        steps: [] };
    case 'key_invalid':
      return { kind, status, detail,
        title: 'The saved API key could not be used',
        summary: err.message,
        steps: ['Open "Edit" on the Live page and paste the JSON file you downloaded from Coinbase again.'] };
    default:
      return { kind: 'network', status, detail,
        title: 'Could not connect to Coinbase',
        summary: `Could not connect to Coinbase${detail ? `: ${detail}` : ''}`,
        steps: [] };
  }
}

// ── Public client ─────────────────────────────────────────────────────────────
// proxyBase: optional origin like 'http://localhost:9999' to route through the local CORS proxy.
// Requests then go to proxyBase/api/v3/brokerage/… but are signed for api.coinbase.com.
// Coinbase answers a rejected order with HTTP 200 and { success: false, error_response }.
function orderResult(json) {
  if (json && json.success === false) {
    const er = json.error_response ?? {};
    const why = er.message || er.preview_failure_reason || er.error || json.failure_reason || 'no reason given';
    throw new CoinbaseError('order_rejected', `Coinbase rejected the order: ${why}`, { detail: String(er.error_details ?? '').slice(0, 300) });
  }
  return json;
}

// Stocks/ETFs (product_type EQUITY) trade through the same /orders endpoint; market orders
// must say they are for the regular session (9:30–16:00 ET) and are good for the day.
const EQUITY_MARKET_METADATA = {
  equity_trading_session: 'EQUITY_TRADING_SESSION_NORMAL',
  displayed_order_config: 'MARKET_GFD',
};

export function createCoinbaseClient(apiKey, apiSecret, proxyBase = null) {
  const origin = proxyBase ? proxyBase.replace(/\/+$/, '') : API_ORIGIN;
  const r = (m, p, b = null, q = null) => req(apiKey, apiSecret, m, p, b, q, origin, Boolean(proxyBase));
  const order = (body) => r('POST', '/orders', body).then(orderResult);
  const id = (v) => encodeURIComponent(String(v));
  // POST /orders/batch_cancel → { results: [{ success, failure_reason, order_id }] }
  const cancelOrders = (orderIds) => r('POST', '/orders/batch_cancel', { order_ids: [...orderIds].map(String) });
  return {
    getAccounts:     ()                                    => r('GET',  '/accounts'),
    // Every account page (GET /accounts follows `cursor` while `has_next`) → { accounts: [...] }
    getAllAccounts: async () => {
      const accounts = [];
      let cursor = null;
      for (let page = 0; page < 20; page++) {
        const json = await r('GET', '/accounts', null, cursor ? { limit: '250', cursor } : { limit: '250' });
        accounts.push(...(json?.accounts ?? []));
        cursor = json?.has_next && json?.cursor ? json.cursor : null;
        if (!cursor) break;
      }
      return { accounts };
    },
    getProduct:      (productId) => r('GET', `/products/${id(productId)}`),
    getOrder:        (orderId) => r('GET', `/orders/historical/${id(orderId)}`),
    listPortfolios:  () => r('GET', '/portfolios'),
    getPortfolioBreakdown: (uuid) => r('GET', `/portfolios/${id(uuid)}`),
    placeMarketBuy:  (clientOrderId, productId, quoteSize) =>
      order({ client_order_id: clientOrderId, product_id: productId, side: 'BUY',
        order_configuration: { market_market_ioc: { quote_size: String(quoteSize) } } }),
    placeMarketSell: (clientOrderId, productId, baseSize) =>
      order({ client_order_id: clientOrderId, product_id: productId, side: 'SELL',
        order_configuration: { market_market_ioc: { base_size: String(baseSize) } } }),
    placeLimitOrder: (clientOrderId, productId, side, baseSize, limitPrice) =>
      order({ client_order_id: clientOrderId, product_id: productId, side,
        order_configuration: { limit_limit_gtc: { base_size: String(baseSize), limit_price: String(limitPrice) } } }),
    // Stock/ETF market orders: buy in dollars, sell in shares (fractional to 0.00001).
    placeEquityMarketBuy: (clientOrderId, productId, quoteSize) =>
      order({ client_order_id: clientOrderId, product_id: productId, side: 'BUY',
        order_configuration: { market_market_ioc: { quote_size: String(quoteSize) } },
        equity_order_metadata: { ...EQUITY_MARKET_METADATA } }),
    placeEquityMarketSell: (clientOrderId, productId, baseSize) =>
      order({ client_order_id: clientOrderId, product_id: productId, side: 'SELL',
        order_configuration: { market_market_ioc: { base_size: String(baseSize) } },
        equity_order_metadata: { ...EQUITY_MARKET_METADATA } }),
    // Resting stop-loss for crypto: once the price trades at or below stopPrice, a limit SELL at limitPrice is placed.
    placeStopLimitSell: (clientOrderId, productId, baseSize, stopPrice, limitPrice) =>
      order({ client_order_id: clientOrderId, product_id: productId, side: 'SELL',
        order_configuration: { stop_limit_stop_limit_gtc: {
          base_size: String(baseSize), limit_price: String(limitPrice), stop_price: String(stopPrice),
          stop_direction: 'STOP_DIRECTION_STOP_DOWN',
        } } }),
    cancelOrders,
    cancelOrder:     (orderId) => cancelOrders([orderId]),
    listOrders:      (params = {}) => r('GET', '/orders/historical/batch', null, params),
    getBestBidAsk:   (productIds) => r('GET', '/best_bid_ask', null, { product_ids: productIds }),
  };
}

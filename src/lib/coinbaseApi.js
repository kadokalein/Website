// Coinbase Advanced Trade API — supports both key types:
//   • New CDP keys (Ed25519 JWT) — algorithm shown as "Ed25519" on coinbase.com
//   • Legacy keys (HMAC-SHA256) — older format from Coinbase Pro
//
// Keys are read from the caller and never sent to any server except api.coinbase.com.

const BASE = 'https://api.coinbase.com/api/v3/brokerage';

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
async function importEd25519(pem) {
  const b64 = pem.replace(/-----BEGIN (?:EC |)PRIVATE KEY-----|-----END (?:EC |)PRIVATE KEY-----|\n|\r/g, '');
  const der  = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
}

async function makeJWT(keyName, privatePEM, method, path) {
  const key     = await importEd25519(privatePEM);
  const header  = b64url({ alg: 'EdDSA', kid: keyName });
  const now     = Math.floor(Date.now() / 1000);
  // Coinbase expects URI = "<METHOD> <host><path>" (no query string)
  const payload = b64url({ sub: keyName, iss: 'cdp', nbf: now, exp: now + 120, uri: `${method} api.coinbase.com${path}` });
  const msg     = `${header}.${payload}`;
  const sig     = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(msg));
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
async function req(apiKey, apiSecret, method, path, body = null, params = null) {
  const bodyStr = body ? JSON.stringify(body) : '';
  let url = BASE + path;
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
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.message ?? json?.error_details ?? json?.error ?? json?.preview_failure_reason ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

// ── Public client ──────────────────────────────────────────────────────────────
export function createCoinbaseClient(apiKey, apiSecret) {
  const r = (m, p, b, q) => req(apiKey, apiSecret, m, p, b, q);
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

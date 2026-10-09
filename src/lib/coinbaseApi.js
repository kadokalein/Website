// Coinbase Advanced Trade API — JavaScript port of the Python client.
// Uses Web Crypto API for HMAC-SHA256 signing (no external libraries needed).
// NOTE: API keys are stored in localStorage and never sent to any server other than
// api.coinbase.com. Use a read+trade scoped key from Coinbase Advanced Trade settings.

const BASE = 'https://api.coinbase.com/api/v3/brokerage';

async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function req(apiKey, apiSecret, method, path, body = null, params = null) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyStr = body ? JSON.stringify(body) : '';
  const signature = await hmacSign(apiSecret, timestamp + method + path + bodyStr);

  let url = BASE + path;
  if (params) url += '?' + new URLSearchParams(params).toString();

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'CB-ACCESS-KEY': apiKey,
      'CB-ACCESS-SIGN': signature,
      'CB-ACCESS-TIMESTAMP': timestamp,
    },
    body: body ? bodyStr : undefined,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.message ?? json?.error ?? `HTTP ${res.status}`);
  return json;
}

export function createCoinbaseClient(apiKey, apiSecret) {
  const r = (method, path, body, params) => req(apiKey, apiSecret, method, path, body, params);

  return {
    // Accounts
    getAccounts: () => r('GET', '/accounts'),

    // Orders
    placeMarketBuy: (clientOrderId, productId, quoteSize) =>
      r('POST', '/orders', {
        client_order_id: clientOrderId,
        product_id: productId,
        side: 'BUY',
        order_configuration: { market_market_ioc: { quote_size: String(quoteSize) } },
      }),

    placeMarketSell: (clientOrderId, productId, baseSize) =>
      r('POST', '/orders', {
        client_order_id: clientOrderId,
        product_id: productId,
        side: 'SELL',
        order_configuration: { market_market_ioc: { base_size: String(baseSize) } },
      }),

    placeLimitOrder: (clientOrderId, productId, side, baseSize, limitPrice) =>
      r('POST', '/orders', {
        client_order_id: clientOrderId,
        product_id: productId,
        side,
        order_configuration: {
          limit_limit_gtc: { base_size: String(baseSize), limit_price: String(limitPrice) },
        },
      }),

    cancelOrder: (orderId) =>
      r('POST', '/orders/cancel', { order_ids: [orderId] }),

    listOrders: (params = {}) =>
      r('GET', '/orders/historical/batch', null, params),

    getBestBidAsk: (productIds) =>
      r('GET', '/best_bid_ask', null, { product_ids: productIds }),
  };
}

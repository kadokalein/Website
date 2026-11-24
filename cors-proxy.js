// Coinbase CORS proxy — run with: node cors-proxy.js   (Node.js 18 or newer, no installs needed)
// Forwards http://localhost:9999/api/v3/... → https://api.coinbase.com/api/v3/...
// Your API key never passes through here: the web page signs each request in your browser,
// and this script only relays it to api.coinbase.com (Coinbase refuses signed requests
// sent straight from a web page).
/* global require, Buffer */
'use strict';

const http = require('http');
const https = require('https');

const PORT = 9999;
const TARGET_HOST = 'api.coinbase.com';
const UPSTREAM_TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 1024 * 1024;

// Only these request headers are passed on to Coinbase (origin, referer, cookies, sec-* … are dropped).
const FORWARD_HEADERS = [
  'authorization', 'content-type', 'accept', 'user-agent',
  'cb-access-key', 'cb-access-sign', 'cb-access-timestamp', 'cb-access-passphrase',
];
// Upstream response headers that are not passed back to the page.
const DROP_RESPONSE_HEADERS = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'set-cookie', 'content-length',
]);

// Web pages allowed to use this proxy.
const ALLOWED_ORIGINS = new Set(['https://kadokalein.github.io']);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

function allowedOrigin(origin) {
  return origin && (ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin)) ? origin : null;
}

function corsHeaders(req, preflight) {
  const headers = { Vary: 'Origin' };
  const origin = allowedOrigin(req.headers.origin);
  if (!origin) return headers;
  headers['Access-Control-Allow-Origin'] = origin;
  if (preflight) {
    headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] =
      'Content-Type, Authorization, CB-ACCESS-KEY, CB-ACCESS-SIGN, CB-ACCESS-TIMESTAMP, CB-ACCESS-PASSPHRASE';
    headers['Access-Control-Max-Age'] = '600';
    // Chrome's Private Network Access check for public HTTPS sites calling http://localhost.
    headers['Access-Control-Allow-Private-Network'] = 'true';
  }
  return headers;
}

function sendJson(res, status, cors, obj) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  const preflight = req.method === 'OPTIONS';
  const cors = corsHeaders(req, preflight);
  const fromBlockedSite = Boolean(req.headers.origin) && !allowedOrigin(req.headers.origin);

  if (preflight) {
    res.writeHead(fromBlockedSite ? 403 : 204, cors);
    res.end();
    return;
  }

  // Health check — lets the app confirm THIS proxy is running
  if (req.url === '/health') {
    sendJson(res, 200, cors, { proxy: 'coinbase-cors-proxy', port: PORT, version: 2 });
    return;
  }

  if (fromBlockedSite) {
    sendJson(res, 403, cors, { error: 'proxy_forbidden_origin', message: `Origin ${req.headers.origin} is not allowed` });
    return;
  }
  if (!req.url.startsWith('/api/v3/')) {
    sendJson(res, 404, cors, { error: 'proxy_not_found', message: 'Only /api/v3/ paths are forwarded' });
    return;
  }

  const chunks = [];
  let size = 0;
  req.on('data', c => {
    size += c.length;
    if (size > MAX_BODY_BYTES) { sendJson(res, 413, cors, { error: 'proxy_body_too_large', message: 'Request body too large' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('error', () => res.destroy());
  req.on('end', () => {
    if (res.writableEnded) return;
    const body = Buffer.concat(chunks);
    const headers = { host: TARGET_HOST };
    for (const h of FORWARD_HEADERS) if (req.headers[h] !== undefined) headers[h] = req.headers[h];
    if (body.length) headers['content-length'] = String(body.length);

    let timedOut = false;
    const upstream = https.request({ hostname: TARGET_HOST, port: 443, path: req.url, method: req.method, headers }, r => {
      const out = { ...cors };
      for (const [k, v] of Object.entries(r.headers)) {
        if (!DROP_RESPONSE_HEADERS.has(k) && !k.startsWith('access-control-') && k !== 'vary') out[k] = v;
      }
      res.writeHead(r.statusCode, out);
      r.pipe(res);
      r.on('end', () => clearTimeout(timer));
      r.on('error', () => res.destroy());
    });
    const timer = setTimeout(() => { timedOut = true; upstream.destroy(new Error('timeout')); }, UPSTREAM_TIMEOUT_MS);

    upstream.on('error', e => {
      clearTimeout(timer);
      if (timedOut) {
        sendJson(res, 504, cors, { error: 'proxy_timeout', message: `api.coinbase.com did not answer within ${UPSTREAM_TIMEOUT_MS / 1000} seconds` });
      } else {
        sendJson(res, 502, cors, { error: 'proxy_upstream_error', message: `Could not reach api.coinbase.com: ${e.message}` });
      }
      console.error(`  ✗ ${req.method} ${req.url.split('?')[0]} — ${timedOut ? 'timeout' : e.message}`);
    });
    upstream.end(body);
  });
}).listen(PORT, () => {
  console.log(`✓ Coinbase CORS proxy running at http://localhost:${PORT}`);
  console.log(`  Forwarding → https://${TARGET_HOST}`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log(`  Keep this window open while using Live Trading.`);
}).on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`✗ Port ${PORT} is already in use — is the proxy already running in another window?`);
  else console.error(`✗ ${e.message}`);
});

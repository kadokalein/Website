// Coinbase CORS proxy — run with: node cors-proxy.js
// Forwards http://localhost:9999/... → https://api.coinbase.com/...
const http = require('http');
const https = require('https');

const PORT = 9999;
const TARGET_HOST = 'api.coinbase.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, CB-ACCESS-KEY, CB-ACCESS-SIGN, CB-ACCESS-TIMESTAMP',
  // Required by Chrome 94+ Private Network Access: allows HTTPS pages on public domains
  // (like github.io) to fetch http://localhost without being blocked as mixed content.
  'Access-Control-Allow-Private-Network': 'true',
};

http.createServer((req, res) => {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  // Health check — lets the app confirm THIS proxy is running
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ proxy: 'coinbase-cors-proxy', port: PORT }));
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const options = {
    hostname: TARGET_HOST,
    port: 443,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: TARGET_HOST },
  };

  const proxy = https.request(options, r => {
    const headers = { ...r.headers, ...CORS_HEADERS };
    res.writeHead(r.statusCode, headers);
    r.pipe(res);
  });

  proxy.on('error', e => {
    res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
    res.end(`Proxy error: ${e.message}`);
  });

  req.pipe(proxy);
}).listen(PORT, () => {
  console.log(`✓ Coinbase CORS proxy running at http://localhost:${PORT}`);
  console.log(`  Forwarding → https://${TARGET_HOST}`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log(`  Keep this window open while using Live Trading.`);
});

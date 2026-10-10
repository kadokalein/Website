// Coinbase CORS proxy — run with: node cors-proxy.js
// Forwards http://localhost:8080/... → https://api.coinbase.com/...
const http = require('http');
const https = require('https');

const PORT = 8080;
const TARGET_HOST = 'api.coinbase.com';

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, Authorization, CB-ACCESS-KEY, CB-ACCESS-SIGN, CB-ACCESS-TIMESTAMP');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
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
    const headers = { ...r.headers, 'access-control-allow-origin': '*' };
    res.writeHead(r.statusCode, headers);
    r.pipe(res);
  });

  proxy.on('error', e => {
    res.writeHead(502);
    res.end(e.message);
  });

  req.pipe(proxy);
}).listen(PORT, () => {
  console.log(`✓ Proxy running at http://localhost:${PORT}`);
  console.log(`  Forwarding → https://${TARGET_HOST}`);
  console.log(`  Keep this window open while using Live Trading.`);
});

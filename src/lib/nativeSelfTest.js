// Self-check run inside the iPhone app, only in the test build GitHub Actions makes
// (VITE_NATIVE_SELFTEST=1, see .github/workflows/ios.yml). It proves, on a real iOS web view,
// the things the app depends on that cannot be checked in a desktop browser: Web Crypto signing
// (ECDSA and Ed25519), signed Coinbase requests sent by iOS without the proxy, request bodies
// arriving unchanged, ordinary web requests from the app's origin, storage, alerts streaming,
// keep-awake and the notch (safe-area) insets.
// Results go to the console ("[selftest] PASS …", ending in "[selftest] DONE pass=N fail=M"),
// which the workflow reads from the simulator, and onto the screen for the screenshot.
// Only throwaway keys made here are used; nothing personal is sent anywhere.

import { KeepAwake } from '@capacitor-community/keep-awake';
import { createCoinbaseClient, detectKeyType, makeJWT, CoinbaseError } from './coinbaseApi.js';
import { getCandles, getPrices } from './coinbaseMarket.js';
import { idbGet, idbSet, idbDel } from './idb.js';
import { IS_NATIVE, nativeRequest, pageLink } from './platform.js';
import { hashFromAppUrl } from './nativeApp.js';

const results = [];

function report(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms); }),
  ]);
}

async function check(name, fn, ms = 20_000) {
  try {
    const detail = await withTimeout(Promise.resolve().then(fn), ms, name);
    report(name, true, typeof detail === 'string' ? detail : '');
  } catch (e) {
    report(name, false, String(e?.message ?? e).slice(0, 300));
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const pem = (label, der) => `-----BEGIN ${label}-----\n${b64(der).match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;

// A throwaway ECDSA P-256 key as Coinbase-style PKCS8 PEM.
async function makeEcdsaKey() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return pem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', kp.privateKey));
}

// A throwaway Ed25519 key in Coinbase's default download format: base64(32-byte seed + 32-byte public key).
async function makeEd25519Key() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const both = new Uint8Array(64);
  both.set(pkcs8.slice(-32), 0);
  both.set(pub, 32);
  return b64(both);
}

// Header and payload of a JWT (the third part is the binary signature).
function jwtParts(jwt) {
  const dec = (seg) => {
    const b = seg.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4)));
  };
  const [h, p] = jwt.split('.');
  return { h: dec(h), p: dec(p) };
}

// JSON with object keys sorted, to compare values regardless of key order.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

function show() {
  const pass = results.filter((r) => r.ok).length;
  const box = document.createElement('div');
  box.setAttribute('style', 'position:fixed;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:9999;max-height:60vh;overflow:auto;'
    + 'background:#000c;border:1px solid #30363d;border-radius:8px;padding:8px;font:11px/1.35 ui-monospace,monospace;color:#c9d1d9');
  box.innerHTML = `<div style="font-weight:700;color:${pass === results.length ? '#3fb950' : '#f85149'}">Self-test: ${pass}/${results.length} passed</div>`;
  for (const r of results) {
    const line = document.createElement('div');
    line.textContent = `${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ` — ${r.detail}`}`;
    line.style.color = r.ok ? '#8b949e' : '#f85149';
    box.appendChild(line);
  }
  document.body.appendChild(box);
}

export async function runNativeSelfTest() {
  console.log(`[selftest] START ${navigator.userAgent}`);

  await check('running as the native app', () => { assert(IS_NATIVE, 'Capacitor says this is not a native platform'); return location.href; });
  await check('secure context with Web Crypto', () => {
    assert(window.isSecureContext, 'window.isSecureContext is false');
    assert(crypto?.subtle, 'crypto.subtle is missing');
    return location.origin;
  });

  let ecdsaPem = null, edKey = null;
  await check('ECDSA (ES256) key import and JWT signing', async () => {
    ecdsaPem = await makeEcdsaKey();
    assert(detectKeyType(ecdsaPem) === 'ecdsa', `detected as ${detectKeyType(ecdsaPem)}`);
    const jwt = await makeJWT('organizations/selftest/apiKeys/selftest', ecdsaPem, 'GET', '/api/v3/brokerage/accounts');
    const { h, p } = jwtParts(jwt);
    assert(h.alg === 'ES256' && p.uri === 'GET api.coinbase.com/api/v3/brokerage/accounts', 'unexpected JWT contents');
    return `alg ${h.alg}`;
  });
  await check('Ed25519 (EdDSA) key import and JWT signing', async () => {
    edKey = await makeEd25519Key();
    assert(detectKeyType(edKey) === 'ed25519', `detected as ${detectKeyType(edKey)}`);
    const jwt = await makeJWT('00000000-0000-4000-8000-000000000000', edKey, 'POST', '/api/v3/brokerage/orders');
    const { h } = jwtParts(jwt);
    assert(h.alg === 'EdDSA', `alg ${h.alg}`);
    return 'alg EdDSA';
  });

  await check('localStorage', () => {
    localStorage.setItem('pp_selftest', 'ok');
    assert(localStorage.getItem('pp_selftest') === 'ok', 'value did not round-trip');
    localStorage.removeItem('pp_selftest');
  });
  await check('IndexedDB (stock history cache)', async () => {
    await idbSet('selftest', { n: 42 });
    const v = await idbGet('selftest');
    await idbDel('selftest');
    assert(v?.n === 42, `read back ${JSON.stringify(v)}`);
  });

  await check('native HTTP: Coinbase server time', async () => {
    const r = await nativeRequest('https://api.coinbase.com/api/v3/brokerage/time');
    assert(r.ok, `HTTP ${r.status}`);
    const j = JSON.parse(r.text);
    assert(j.epochSeconds || j.iso, `unexpected body ${r.text.slice(0, 120)}`);
    return `HTTP ${r.status}`;
  });
  for (const [label, name, key] of [
    ['ECDSA', 'organizations/selftest/apiKeys/selftest', () => ecdsaPem],
    ['Ed25519', '00000000-0000-4000-8000-000000000000', () => edKey],
  ]) {
    await check(`signed Coinbase request without a proxy (${label} key reaches Coinbase and is refused as unknown)`, async () => {
      assert(key(), 'no key (the signing check above failed)');
      try {
        await createCoinbaseClient(name, key(), 'http://localhost:9999').getAccounts();
      } catch (e) {
        assert(e instanceof CoinbaseError, `not a CoinbaseError: ${e?.message}`);
        assert(e.kind === 'auth' && (e.status === 401 || e.status === 403), `kind ${e.kind}, status ${e.status}: ${e.message}`);
        return `HTTP ${e.status} from api.coinbase.com`;
      }
      throw new Error('Coinbase accepted a made-up key');
    });
  }
  await check('native HTTP sends a JSON body unchanged', async () => {
    const sent = { product_id: 'BTC-USD', side: 'BUY', order_configuration: { market_market_ioc: { quote_size: '1.00' } }, n: 1.5 };
    const tries = [['https://postman-echo.com/post', 'json'], ['https://httpbin.org/anything', 'json']];
    let last = '';
    for (const [url, field] of tries) {
      try {
        const r = await nativeRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sent), timeoutMs: 15_000 });
        if (!r.ok) { last = `${url} HTTP ${r.status}`; continue; }
        // iOS re-parses JSON responses, so compare values, not key order.
        const echoed = JSON.parse(r.text)[field];
        assert(canonical(echoed) === canonical(sent), `echo differs: ${JSON.stringify(echoed).slice(0, 160)}`);
        return `echoed by ${new URL(url).host}`;
      } catch (e) {
        if (String(e?.message).startsWith('echo differs')) throw e;
        last = `${url}: ${e?.message ?? e}`;
      }
    }
    throw new Error(`no echo service answered (${last})`);
  });

  // Coinbase market data through the app's own client (sent by iOS, see coinbaseMarket.js).
  await check('market data: live prices (BTC, ETH)', async () => {
    const px = await getPrices(['BTC', 'ETH']);
    assert(px.BTC > 0 && px.ETH > 0, `got ${JSON.stringify(px)}`);
    return `BTC ${px.BTC}`;
  }, 30_000);
  await check('market data: daily candles (BTC)', async () => {
    const c = await getCandles('BTC', '1D', 60);
    assert(Array.isArray(c) && c.length >= 50, `got ${c?.length} candles`);
    return `${c.length} candles`;
  }, 30_000);
  // For the record: does Coinbase answer the web view directly? (Not needed — the app goes through iOS.)
  try {
    const r = await fetch('https://api.coinbase.com/api/v3/brokerage/market/products/BTC-USD');
    console.log(`[selftest] INFO web view fetch to api.coinbase.com: HTTP ${r.status}`);
  } catch (e) {
    console.log(`[selftest] INFO web view fetch to api.coinbase.com refused (${e?.message ?? e}) — expected; the app uses native requests`);
  }

  // Ordinary requests from the web view (the app's origin is capacitor://localhost).
  const webChecks = [
    ['Coinbase Exchange candles', 'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400', {}, (r) => r.ok],
    ['Twelve Data (stock prices)', 'https://api.twelvedata.com/quote?symbol=AAPL&apikey=demo', {}, (r) => r.ok],
    ['news feeds (rss2json)', `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent('https://cointelegraph.com/rss')}`, {}, (r) => r.ok || r.status === 422 || r.status === 429],
    ['Fear & Greed index', 'https://api.alternative.me/fng/?limit=1', {}, (r) => r.ok],
    ['Supabase sign-in server', 'https://mbxuttajnjgjakuzcton.supabase.co/auth/v1/health', { headers: { apikey: 'sb_publishable_rxj7UUzt4nprQF3C6DAzBQ_qT71pQ4Y' } }, (r) => r.status < 500],
  ];
  for (const [label, url, opts, good] of webChecks) {
    await check(`web request: ${label}`, async () => {
      const r = await fetch(url, opts);
      assert(good(r), `HTTP ${r.status}`);
      return `HTTP ${r.status}`;
    }, 20_000);
  }
  await check('phone alerts: publish to ntfy.sh', async () => {
    const topic = `pp-selftest-${Math.random().toString(36).slice(2, 12)}`;
    const r = await fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({ topic, message: 'app self-test' }) });
    assert(r.ok, `HTTP ${r.status}`);
    return `HTTP ${r.status}`;
  });
  await check('phone alerts: live stream (EventSource) opens', () => new Promise((resolve, reject) => {
    const es = new EventSource(`https://ntfy.sh/pp-selftest-${Math.random().toString(36).slice(2, 12)}/sse`);
    es.addEventListener('open', () => { es.close(); resolve('connected'); });
    es.onerror = () => { es.close(); reject(new Error('stream failed to open')); };
  }), 15_000);

  await check('keep screen on', async () => {
    const { isKeptAwake } = await KeepAwake.isKeptAwake();
    assert(isKeptAwake, 'screen is allowed to sleep although the setting is on');
  });
  await check('alert links open the app', () => {
    const link = pageLink('#/live');
    assert(link === 'prometheaprograms://open/#/live', link);
    assert(hashFromAppUrl(link) === '#/live', 'link not recognised');
    assert(hashFromAppUrl('prometheaprograms://open/javascript:alert(1)') === null, 'unsafe link accepted');
    return link;
  });
  await check('notch-safe layout (safe-area insets)', () => {
    const probe = document.createElement('div');
    probe.setAttribute('style', 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top);visibility:hidden');
    document.body.appendChild(probe);
    const top = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    assert(top > 0, 'safe-area-inset-top is 0 — the page would sit under the status bar');
    const header = document.querySelector('header');
    const hTop = header ? parseFloat(getComputedStyle(header).paddingTop) : 0;
    assert(!header || hTop >= top, `header padding ${hTop}px is less than the ${top}px inset`);
    return `inset ${top}px, header padding ${hTop}px`;
  });

  // The Trading Desk's first run in the app (real Coinbase data; stocks need a Twelve Data key, so
  // those sectors just report that).
  await check('Trading Desk completes a run in the app', async () => {
    for (let i = 0; i < 90; i++) {
      let last = null;
      try { last = JSON.parse(localStorage.getItem('pp_desk_v1') ?? 'null')?.last; } catch { /* not saved yet */ }
      if (last?.time) {
        const crypto = last.groups?.find((g) => g.id === 'crypto');
        for (const g of last.groups ?? []) console.log(`[selftest] INFO desk ${g.id}: ${g.status}${g.statusText ? ` — ${g.statusText.slice(0, 140)}` : ''}`);
        for (const n of last.notices ?? []) console.log(`[selftest] INFO desk notice: ${String(n).slice(0, 200)}`);
        assert(crypto?.status === 'ok', `crypto: ${crypto?.status} ${crypto?.statusText ?? ''}`);
        return `crypto ok, ${crypto.scouts?.length ?? 0} coins scouted, regime ${crypto.brief?.regime?.label ?? crypto.brief?.stance ?? '?'}`;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('the desk did not finish a run within 90 s');
  }, 100_000);

  // Open an app link the way iOS does when an alert is tapped: the app asks iOS to open its own
  // link, iOS hands it back through the scene delegate, and the app goes to that page.
  await check('app link round trip through iOS (prometheaprograms://open/#/paper)', async () => {
    window.location.hash = '#/';
    await new Promise((r) => setTimeout(r, 500));
    const arrived = new Promise((resolve, reject) => {
      const t = setTimeout(() => { window.removeEventListener('hashchange', on); reject(new Error(`still on ${window.location.hash}`)); }, 10_000);
      function on() { if (window.location.hash === '#/paper') { clearTimeout(t); window.removeEventListener('hashchange', on); resolve(); } }
      window.addEventListener('hashchange', on);
    });
    window.location.href = pageLink('#/paper');
    await arrived;
    return 'arrived on #/paper';
  }, 15_000);

  const pass = results.filter((r) => r.ok).length;
  console.log(`[selftest] DONE pass=${pass} fail=${results.length - pass}`);
  try { show(); } catch { /* screen output is only a convenience */ }
}

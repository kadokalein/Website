// Coinbase public market data (no API key), shared by every page of the site.
//
// Coinbase limits how fast one connection may call its public API. When the
// site goes over that limit Coinbase starts refusing requests, which in a
// browser looks like Coinbase being unreachable. So every request goes through
// one queue here: few at a time, spaced out, identical requests merged,
// recent answers reused, and a pause after Coinbase says "slow down".

const ADVANCED = 'https://api.coinbase.com/api/v3/brokerage/market';
const EXCHANGE = 'https://api.exchange.coinbase.com';

const MAX_CONCURRENT = 2;
const MIN_GAP_MS = 160;          // at most ~6 requests per second, well under Coinbase's limit
const TIMEOUT_MS = 12_000;
const PAGE = 300;                // candles per request (Coinbase caps at 350 / 300)

const HOUR = 3_600_000;
export const TF_MS = { '1H': HOUR, '4H': 4 * HOUR, '1D': 24 * HOUR, '1W': 7 * 24 * HOUR };
const ADV_GRAN = { '1H': 'ONE_HOUR', '4H': 'FOUR_HOUR', '1D': 'ONE_DAY' };
const EXCH_GRAN = { '1H': 3600, '1D': 86400 };
// How long an answer is reused before asking Coinbase again.
const CACHE_MS = { '1H': 60_000, '4H': 120_000, '1D': 120_000, '1W': 600_000, prices: 45_000 };

// ── Errors ───────────────────────────────────────────────────────────────────
export class MarketError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.kind = kind;     // 'rate-limit' | 'blocked' | 'timeout' | 'http' | 'paused' | 'bad-data' | 'not-listed'
    this.status = status;
  }
}

export function explainMarketError(err) {
  const kind = err?.kind;
  if (kind === 'rate-limit') return 'Coinbase is limiting requests from this browser (HTTP 429). The site paused and will retry by itself.';
  if (kind === 'paused') return err.message;
  if (kind === 'blocked') {
    return 'The browser got no answer from Coinbase (api.coinbase.com). Common causes: an ad or tracker blocker or a privacy setting blocking Coinbase, a VPN or network filter, or Coinbase briefly refusing this connection after too many requests. The site retries by itself.';
  }
  if (kind === 'timeout') return 'Coinbase took too long to answer. The site retries by itself.';
  if (kind === 'not-listed') return err.message;
  if (kind === 'http') return `Coinbase answered with an error (HTTP ${err.status}).`;
  return String(err?.message ?? err ?? 'Unknown error');
}

// ── Health (what the UI shows about the connection) ─────────────────────────
const health = { lastOk: null, lastError: null, pausedUntil: 0, source: null };
const listeners = new Set();
export function marketHealth() { return { ...health }; }
export function onMarketHealth(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { const h = marketHealth(); for (const fn of listeners) { try { fn(h); } catch { /* ignore */ } } }

// ── Queue: few requests at a time, evenly spaced ────────────────────────────
const queue = [];
let active = 0;
let lastStart = 0;
let pumpTimer = null;

function pump() {
  pumpTimer = null;
  while (queue.length && active < MAX_CONCURRENT) {
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) { pumpTimer = setTimeout(pump, wait); return; }
    const job = queue.shift();
    active++;
    lastStart = Date.now();
    job.run().then(job.resolve, job.reject).finally(() => { active--; if (!pumpTimer) pump(); });
  }
}

function schedule(run) {
  return new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject });
    if (!pumpTimer) pump();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rawGet(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await readResponse(url, ctl.signal); // the timeout also covers reading the body
  } catch (e) {
    if (e instanceof MarketError) throw e;
    if (e?.name === 'AbortError') throw new MarketError('timeout', 'Coinbase took too long to answer');
    throw new MarketError('blocked', 'No answer from Coinbase');
  } finally {
    clearTimeout(timer);
  }
}

async function readResponse(url, signal) {
  const res = await fetch(url, { signal });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'));
    throw Object.assign(new MarketError('rate-limit', 'Coinbase is limiting requests', 429), { retryAfterMs: retryAfter > 0 ? retryAfter * 1000 : null });
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch (e) { if (e?.name === 'AbortError') throw e; }
    if (res.status === 404 || /not.?found|NotFound|invalid product/i.test(detail)) throw new MarketError('not-listed', 'Not listed on Coinbase', res.status);
    throw new MarketError('http', `HTTP ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
  }
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new MarketError('bad-data', 'Coinbase sent an unreadable answer'); }
}

// ── Per-host protection ──────────────────────────────────────────────────────
// "Slow down" (429) pauses that host briefly. Repeated "no answer" marks the host
// as down for a while, so the site stops hammering it and goes straight to the
// other Coinbase host (or reports the problem quickly) instead of retrying every coin.
const hosts = {};
const hostState = (url) => (hosts[new URL(url).hostname] ??= { pausedUntil: 0, strikes: 0, failStreak: 0, trips: 0, downUntil: 0, lastErr: null });
const RETRYABLE = new Set(['rate-limit', 'blocked', 'timeout']);

function refreshPause() {
  health.pausedUntil = Math.max(0, ...Object.values(hosts).map((h) => Math.max(h.pausedUntil, h.downUntil)));
}

function noteFailure(h, err) {
  const now = Date.now();
  if (err.kind === 'rate-limit') {
    h.strikes++;
    h.pausedUntil = now + (err.retryAfterMs ?? Math.min(60_000, 5_000 * 2 ** (h.strikes - 1)));
  } else if (err.kind === 'blocked' || err.kind === 'timeout') {
    h.failStreak++;
    if (h.failStreak >= 3) { h.downUntil = now + Math.min(300_000, 30_000 * 2 ** h.trips); h.trips++; h.failStreak = 0; }
  }
  if (err.kind !== 'not-listed') {
    h.lastErr = err;
    health.lastError = { kind: err.kind, message: explainMarketError(err), at: now };
  }
  refreshPause();
  emit();
}

function noteSuccess(h, source) {
  h.strikes = 0; h.failStreak = 0; h.trips = 0; h.downUntil = 0;
  health.lastOk = Date.now();
  health.source = source;
  refreshPause();
  emit();
}

async function getJson(url, source, attempts = 2) {
  const h = hostState(url);
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    const now = Date.now();
    if (h.downUntil > now) throw lastErr ?? h.lastErr ?? new MarketError('blocked', 'No answer from Coinbase');
    if (h.pausedUntil > now) {
      if (h.pausedUntil - now > 20_000) throw lastErr ?? h.lastErr ?? new MarketError('rate-limit', 'Coinbase is limiting requests', 429);
      await sleep(h.pausedUntil - now);
    }
    try {
      const json = await schedule(() => rawGet(url));
      noteSuccess(h, source);
      return json;
    } catch (e) {
      const err = e instanceof MarketError ? e : new MarketError('blocked', String(e?.message ?? e));
      noteFailure(h, err);
      lastErr = err;
      if (!RETRYABLE.has(err.kind) || i === attempts - 1) break;
      if (err.kind !== 'rate-limit') await sleep(500 * 2 ** i + Math.random() * 300);
    }
  }
  throw lastErr;
}

// ── Merge identical requests and reuse fresh answers ────────────────────────
const memo = new Map(); // key → { at, value } | { promise }
function cached(key, ttlMs, load) {
  const hit = memo.get(key);
  if (hit?.promise) return hit.promise;
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  const promise = load().then(
    (value) => { memo.set(key, { at: Date.now(), value }); return value; },
    (err) => { if (hit && !hit.promise) memo.set(key, hit); else memo.delete(key); throw err; },
  );
  memo.set(key, { promise, at: hit?.at, value: hit?.value });
  return promise;
}

// ── Candles ──────────────────────────────────────────────────────────────────
const toRow = (time, open, high, low, close, volume) => ({ time, open: +open, high: +high, low: +low, close: +close, volume: +volume });

function finish(byTime, symbol) {
  const out = [...byTime.values()].sort((a, b) => a.time - b.time).filter((c) => c.close > 0);
  if (out.length < 30) throw new MarketError('bad-data', `${symbol}: Coinbase returned too little history`);
  return out;
}

async function advancedCandles(symbol, tf, bars) {
  const secs = TF_MS[tf] / 1000;
  const byTime = new Map();
  let end = Math.floor(Date.now() / 1000);
  for (let left = bars; left > 0; left -= PAGE) {
    const n = Math.min(PAGE, left);
    const start = end - secs * (n - 1);
    const json = await getJson(`${ADVANCED}/products/${symbol}-USD/candles?start=${start}&end=${end}&granularity=${ADV_GRAN[tf]}&limit=${n}`, 'Coinbase', 3);
    const page = json.candles ?? [];
    for (const k of page) { const t = Number(k.start) * 1000; byTime.set(t, toRow(t, k.open, k.high, k.low, k.close, k.volume)); }
    if (page.length < n / 2) break;
    end = start - secs;
  }
  return finish(byTime, symbol);
}

// Coinbase Exchange API: a second Coinbase host, used when the first refuses.
// It has no 4-hour candles, so those are built from hourly ones.
async function exchangeCandles(symbol, tf, bars) {
  const base = tf === '4H' ? '1H' : tf;
  const want = tf === '4H' ? Math.min(bars, 150) * 4 : bars;
  const secs = TF_MS[base] / 1000;
  const byTime = new Map();
  let end = Math.floor(Date.now() / 1000);
  for (let left = want; left > 0; left -= PAGE) {
    const n = Math.min(PAGE, left);
    const start = end - secs * (n - 1);
    const iso = (s) => new Date(s * 1000).toISOString();
    const rows = await getJson(`${EXCHANGE}/products/${symbol}-USD/candles?granularity=${EXCH_GRAN[base]}&start=${iso(start)}&end=${iso(end)}`, 'Coinbase Exchange');
    if (!Array.isArray(rows)) throw new MarketError('bad-data', 'Unexpected answer from Coinbase Exchange');
    for (const [t, low, high, open, close, volume] of rows) byTime.set(t * 1000, toRow(t * 1000, open, high, low, close, volume));
    if (rows.length < n / 2) break;
    end = start - secs;
  }
  const hourly = finish(byTime, symbol);
  return tf === '4H' ? aggregate(hourly, TF_MS['4H']) : hourly;
}

// Combine bars into larger ones aligned to UTC (4-hour blocks, or weeks starting Monday).
function aggregate(candles, ms, offset = 0) {
  const out = [];
  for (const c of candles) {
    const bucket = Math.floor((c.time - offset) / ms) * ms + offset;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, c.high); last.low = Math.min(last.low, c.low);
      last.close = c.close; last.volume += c.volume;
    } else out.push({ ...c, time: bucket });
  }
  return out;
}

const MONDAY_OFFSET = 4 * TF_MS['1D']; // 1970-01-01 was a Thursday

const stamp = (arr, at) => Object.defineProperty(arr, 'fetchedAt', { value: at, enumerable: false });

// Candles oldest-first. The LAST candle is still forming (callers that analyse
// must drop it). The array carries `fetchedAt` (ms): an answer may be reused for
// a short while, so "has this candle closed?" must be judged against that time,
// not the current time. Throws MarketError.
export function getCandles(symbol, tf, bars = 300) {
  return cached(`${symbol}|${tf}|${bars}`, CACHE_MS[tf], async () => {
    const at = Date.now();
    if (tf === '1W') {
      const daily = await getCandles(symbol, '1D', Math.min(350, bars * 7));
      return stamp(aggregate(daily, TF_MS['1W'], MONDAY_OFFSET).slice(-bars), daily.fetchedAt ?? at);
    }
    try {
      return stamp(await advancedCandles(symbol, tf, bars), at);
    } catch (e) {
      if (e.kind === 'not-listed') throw new MarketError('not-listed', `${symbol} is not listed on Coinbase`, e.status);
      try {
        return stamp(await exchangeCandles(symbol, tf, bars), at);
      } catch (e2) {
        if (e2?.kind === 'not-listed') throw new MarketError('not-listed', `${symbol} is not listed on Coinbase`, e2.status);
        throw e;
      }
    }
  });
}

// Latest price for many coins in ONE request. Returns { SYM: price } (coins
// Coinbase did not answer for are simply missing).
export function getPrices(symbols) {
  const ids = [...new Set(symbols)].sort();
  return cached(`prices|${ids.join(',')}`, CACHE_MS.prices, async () => {
    const qs = ids.map((s) => `product_ids=${encodeURIComponent(`${s}-USD`)}`).join('&');
    const json = await getJson(`${ADVANCED}/products?${qs}`, 'Coinbase');
    const out = {};
    for (const p of json.products ?? []) {
      const sym = String(p.product_id ?? '').replace(/-USD$/, '');
      const price = Number(p.price);
      if (ids.includes(sym) && price > 0) out[sym] = price;
    }
    return out;
  });
}

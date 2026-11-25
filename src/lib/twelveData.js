// Twelve Data (stock and ETF prices) on the free plan, called from the browser with
// the owner's own key. The key stays in this browser's localStorage and is only
// ever sent to api.twelvedata.com.
//
// Free plan: 8 credits per clock minute (reset at the start of each minute) and 800
// per day (reset at 00:00 UTC). Every symbol in a request costs 1 credit, batched or
// not, so this module never spends more than 7 credits in one minute and keeps a
// shared ledger in localStorage so several tabs cannot overspend together.

const BASE = 'https://api.twelvedata.com';
export const TD_KEY_STORAGE = 'pp_twelvedata_key_v1';
const LEDGER_KEY = 'pp_twelvedata_ledger_v1';
const MINUTE_LIMIT = 7;
const DAY_LIMIT = 800;
const SOFT_DAY_LIMIT = 760;
const TIMEOUT_MS = 15_000;

export function loadTdKey() {
  try { return localStorage.getItem(TD_KEY_STORAGE) || null; } catch { return null; }
}
export function saveTdKey(key) {
  try { localStorage.setItem(TD_KEY_STORAGE, String(key ?? '').trim()); } catch { /* private mode */ }
}
export function clearTdKey() {
  try { localStorage.removeItem(TD_KEY_STORAGE); } catch { /* ignore */ }
}

export class TdError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.kind = kind; // 'no-key'|'bad-key'|'minute-limit'|'day-limit'|'plan'|'not-found'|'blocked'|'timeout'|'http'|'bad-data'
    this.status = status;
  }
}

export function explainTdError(err) {
  switch (err?.kind) {
    case 'no-key': return 'Add your free Twelve Data key on the Portfolio page so the desk can read stock charts.';
    case 'bad-key': return 'Twelve Data rejected the API key — check it on the Portfolio page.';
    case 'day-limit': return "Today's free Twelve Data allowance (800 requests) is used up; stock data resumes after midnight UTC (7 pm ET in winter, 8 pm in summer).";
    case 'minute-limit': return 'Waiting for the next minute to stay within the free Twelve Data limit.';
    case 'plan': return 'That data needs a paid Twelve Data plan, so the desk skips it.';
    case 'not-found': return 'Twelve Data does not know that symbol.';
    case 'blocked': return 'The browser got no answer from Twelve Data (api.twelvedata.com) — an ad or privacy blocker, a VPN or a network filter may be blocking it.';
    case 'timeout': return 'Twelve Data took too long to answer.';
    case 'http': return `Twelve Data answered with an error (HTTP ${err.status}).`;
    default: return String(err?.message ?? 'Unknown Twelve Data error');
  }
}

// ── Credit ledger ────────────────────────────────────────────────────────────
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const minuteOf = (t = Date.now()) => Math.floor(t / 60_000);

function readLedger() {
  let l;
  try { l = JSON.parse(localStorage.getItem(LEDGER_KEY) ?? 'null'); } catch { l = null; }
  const now = Date.now();
  if (!l || l.day !== utcDay(now)) l = { day: utcDay(now), used: 0, minute: minuteOf(now), minuteUsed: 0 };
  if (l.minute !== minuteOf(now)) { l.minute = minuteOf(now); l.minuteUsed = 0; }
  return l;
}
function writeLedger(l) {
  try { localStorage.setItem(LEDGER_KEY, JSON.stringify(l)); } catch { /* ignore */ }
}

export function tdUsage() {
  const l = readLedger();
  return { usedToday: l.used, dayLimit: DAY_LIMIT, softDayLimit: SOFT_DAY_LIMIT, usedThisMinute: l.minuteUsed, minuteLimit: MINUTE_LIMIT };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait until n credits fit in the current minute and the day, then book them.
async function reserve(n) {
  for (;;) {
    const l = readLedger();
    if (l.used + n > SOFT_DAY_LIMIT) throw new TdError('day-limit', 'Daily Twelve Data allowance used up');
    if (l.minuteUsed + n <= MINUTE_LIMIT) {
      l.used += n; l.minuteUsed += n;
      writeLedger(l);
      return;
    }
    const wait = (minuteOf() + 1) * 60_000 - Date.now() + 1500;
    await sleep(Math.max(500, wait));
  }
}

function markDayExhausted() {
  const l = readLedger();
  l.used = DAY_LIMIT;
  writeLedger(l);
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
function classify(status, body) {
  const code = typeof body?.code === 'number' ? body.code : status;
  const msg = String(body?.message ?? '');
  if (code === 429) {
    const daily = /day/i.test(msg) && !/minute/i.test(msg);
    return new TdError(daily ? 'day-limit' : 'minute-limit', daily ? 'Daily allowance used up' : 'Minute allowance used up', 429);
  }
  if (/available starting with/i.test(msg)) return new TdError('plan', 'Needs a paid plan', code);
  if (code === 401 || code === 403 || /api ?key/i.test(msg)) return new TdError('bad-key', 'API key rejected', code);
  if (code === 404 || /not found|invalid symbol|symbol .*not/i.test(msg)) return new TdError('not-found', 'Symbol not found', code);
  return new TdError('http', `HTTP ${code}`, code);
}

// GET a Twelve Data endpoint. No custom headers, so the browser sends a simple
// request with no CORS preflight. The timeout also covers reading the body.
async function get(path, params) {
  const key = loadTdKey();
  if (!key) throw new TdError('no-key', 'No Twelve Data key');
  return getWithKey(path, params, key);
}

async function getWithKey(path, params, key) {
  const qs = new URLSearchParams({ ...params, apikey: key }).toString();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(`${BASE}${path}?${qs}`, { signal: ctl.signal });
    } catch (e) {
      throw new TdError(e?.name === 'AbortError' ? 'timeout' : 'blocked', 'No answer from Twelve Data');
    }
    let body = null;
    try { body = JSON.parse(await res.text()); } catch (e) {
      if (e?.name === 'AbortError') throw new TdError('timeout', 'Twelve Data took too long');
      body = null;
    }
    if (!res.ok || (body && body.status === 'error' && typeof body.code === 'number')) throw classify(res.status, body);
    if (!body || typeof body !== 'object') throw new TdError('bad-data', 'Unreadable answer from Twelve Data');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// Spend credits for `symbols`, call, and retry once after a minute-limit answer.
async function batched(path, symbols, params) {
  await reserve(symbols.length);
  try {
    return await get(path, { ...params, symbol: symbols.join(',') });
  } catch (e) {
    if (e.kind === 'minute-limit') {
      const wait = (minuteOf() + 1) * 60_000 - Date.now() + 1500;
      await sleep(Math.max(1000, wait));
      await reserve(symbols.length);
      return get(path, { ...params, symbol: symbols.join(',') });
    }
    if (e.kind === 'day-limit') markDayExhausted();
    throw e;
  }
}

// A batch answer is keyed by symbol; a single-symbol answer is the bare object.
function perSymbol(body, symbols) {
  if (symbols.length === 1) return { [symbols[0]]: body };
  const out = {};
  const keys = Object.keys(body);
  for (const s of symbols) {
    const k = keys.find((x) => x.toUpperCase() === s);
    out[s] = k ? body[k] : null;
  }
  return out;
}

function parseDate(str) {
  const m = String(str ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { time: Date.UTC(+m[1], +m[2] - 1, +m[3]), date: `${m[1]}-${m[2]}-${m[3]}` } : null;
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const FATAL = new Set(['bad-key', 'day-limit', 'no-key']);

// Daily candles, oldest first: { data: { SYM: [{ time, date, open, high, low, close, volume }] }, errors: { SYM: TdError } }.
// The last candle may be today's still-forming bar (callers decide).
export async function tdTimeSeries(symbols, { outputsize = 400 } = {}) {
  const syms = [...new Set(symbols.map((s) => String(s).toUpperCase()))];
  const data = {}, errors = {};
  let fatal = null;
  for (const part of chunk(syms, MINUTE_LIMIT)) {
    if (fatal) { for (const s of part) errors[s] = fatal; continue; }
    let body;
    try {
      body = await batched('/time_series', part, { interval: '1day', outputsize: String(outputsize), order: 'asc' });
    } catch (e) {
      const err = e instanceof TdError ? e : new TdError('blocked', String(e?.message ?? e));
      for (const s of part) errors[s] = err;
      if (FATAL.has(err.kind)) fatal = err;
      continue;
    }
    const map = perSymbol(body, part);
    for (const s of part) {
      const v = map[s];
      if (!v || v.status === 'error' || !Array.isArray(v.values)) { errors[s] = v?.status === 'error' ? classify(v.code, v) : new TdError('bad-data', 'No data'); continue; }
      const rows = [];
      for (const r of v.values) {
        const d = parseDate(r.datetime);
        const close = Number(r.close);
        if (!d || !(close > 0)) continue;
        rows.push({ ...d, open: Number(r.open), high: Number(r.high), low: Number(r.low), close, volume: Number(r.volume ?? 0) });
      }
      rows.sort((a, b) => a.time - b.time);
      data[s] = rows;
    }
  }
  return { data, errors };
}

// Latest quotes: { quotes: { SYM: { price, open, high, low, prevClose, volume, isMarketOpen, time, high52, low52 } }, errors }.
export async function tdQuotes(symbols) {
  const syms = [...new Set(symbols.map((s) => String(s).toUpperCase()))];
  const use = syms.slice(0, MINUTE_LIMIT);
  const quotes = {}, errors = {};
  for (const s of syms.slice(MINUTE_LIMIT)) errors[s] = new TdError('minute-limit', 'skipped to stay within the free limit');
  if (!use.length) return { quotes, errors };
  let body;
  try {
    body = await batched('/quote', use, {});
  } catch (e) {
    const err = e instanceof TdError ? e : new TdError('blocked', String(e?.message ?? e));
    for (const s of use) errors[s] = err;
    return { quotes, errors };
  }
  const map = perSymbol(body, use);
  for (const s of use) {
    const q = map[s];
    if (!q || q.status === 'error') { errors[s] = q ? classify(q.code, q) : new TdError('bad-data', 'No quote'); continue; }
    const price = Number(q.close);
    if (!(price > 0)) { errors[s] = new TdError('bad-data', 'No price'); continue; }
    const ts = Number(q.last_quote_at ?? q.timestamp);
    quotes[s] = {
      price, open: Number(q.open), high: Number(q.high), low: Number(q.low),
      prevClose: Number(q.previous_close), volume: Number(q.volume ?? 0),
      isMarketOpen: q.is_market_open === true,
      time: ts > 0 ? ts * 1000 : Date.now(),
      high52: Number(q.fifty_two_week?.high) || null, low52: Number(q.fifty_two_week?.low) || null,
    };
  }
  return { quotes, errors };
}

// Check a key with one request (1 credit) without saving it.
export async function tdCheckKey(key) {
  const k = String(key ?? '').trim();
  if (!k) return { ok: false, error: new TdError('no-key', 'No key') };
  try {
    await reserve(1);
    const body = await getWithKey('/quote', { symbol: 'SPY' }, k);
    if (!(Number(body.close) > 0)) return { ok: false, error: new TdError('bad-data', 'No price for SPY') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof TdError ? e : new TdError('blocked', String(e?.message ?? e)) };
  }
}

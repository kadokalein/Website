// Stock data for the Trading Desk: closed daily candles for every stock and ETF the
// desk follows, kept in this browser (IndexedDB) and topped up in the background
// from Twelve Data within the free plan's limits, plus a few live quotes during
// market hours.

import { tdTimeSeries, tdQuotes, tdUsage, loadTdKey, explainTdError, TdError } from '../../lib/twelveData';
import { idbGet, idbSet } from '../../lib/idb';
import { usMarketStatus } from './usMarket';

const STORE_KEY = 'stock_daily_v1';
const HIST_KEY = 'stock_hist_v1:';
const MAX_ROWS = 420;
const FULL_BARS = 260;           // below this, download the full history
const QUOTE_TTL = 4 * 60_000;
const MAX_QUOTES = 6;
const NOT_FOUND_MS = 24 * 3_600_000;

let store = null;                // sym → { fetchedAt, lastDate, rows: [[time, open, high, low, close, volume], ...] }
let loading = null;
const notFound = {};             // sym → time Twelve Data said it does not exist
const quoteCache = {};           // sym → { at, quote }
const listeners = new Set();
const st = { total: 0, refreshing: false, pending: [], lastRefresh: null, error: null, errorKind: null };
let wanted = [];                 // symbols the desk asked for last
let priorityList = [];
let loop = null;

const pack = (c) => [c.time, c.open, c.high, c.low, c.close, c.volume];
const unpack = (r) => ({ time: r[0], date: new Date(r[0]).toISOString().slice(0, 10), open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] });

async function ensureStore() {
  if (store) return store;
  loading ??= idbGet(STORE_KEY).then((v) => { store = v && typeof v === 'object' ? v : {}; return store; });
  return loading;
}

function persist() {
  return idbSet(STORE_KEY, store);
}

export function stockDataStatus() {
  const keySet = !!loadTdKey();
  const loaded = store ? wanted.filter((s) => (store[s]?.rows?.length ?? 0) >= 60).length : 0;
  return {
    keySet, loaded, total: wanted.length || st.total, refreshing: st.refreshing, pending: [...st.pending],
    lastRefresh: st.lastRefresh, error: keySet ? st.error : null, errorKind: keySet ? st.errorKind : 'no-key',
    credits: tdUsage(), market: usMarketStatus(),
  };
}

export function onStockDataStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  const s = stockDataStatus();
  for (const fn of listeners) { try { fn(s); } catch { /* ignore */ } }
}

function isStale(sym, lastSession) {
  const e = store[sym];
  return !e?.rows?.length || (e.lastDate ?? '') < lastSession;
}

// Closed bars only: never keep today's bar before the session has closed (+15 min).
function closedRows(rows, market) {
  return rows.filter((r) => r.date <= market.lastCompletedSession);
}

function merge(sym, rows, market) {
  const closed = closedRows(rows, market);
  if (!closed.length) return;
  const prev = store[sym]?.rows ?? [];
  const byTime = new Map(prev.map((r) => [r[0], r]));
  for (const c of closed) byTime.set(c.time, pack(c));
  const all = [...byTime.values()].sort((a, b) => a[0] - b[0]).slice(-MAX_ROWS);
  store[sym] = { fetchedAt: Date.now(), lastDate: new Date(all[all.length - 1][0]).toISOString().slice(0, 10), rows: all };
}

// Instant: whatever is stored. → { daily: { SYM: candles }, stale: { SYM: lastDate|null } }
export async function getStockDaily(symbols) {
  await ensureStore();
  const market = usMarketStatus();
  const daily = {}, stale = {};
  for (const sym of symbols) {
    const e = store[sym];
    if (e?.rows?.length) daily[sym] = e.rows.map(unpack);
    if (isStale(sym, market.lastCompletedSession)) stale[sym] = e?.lastDate ?? null;
  }
  return { daily, stale };
}

// Start (or continue) ONE background refresh of stale symbols, priority first.
export function refreshStockDaily(symbols, { priority = [] } = {}) {
  wanted = [...new Set(symbols)];
  priorityList = [...new Set(priority)];
  st.total = wanted.length;
  if (!loadTdKey()) {
    st.error = explainTdError(new TdError('no-key', ''));
    st.errorKind = 'no-key';
    emit();
    return Promise.resolve();
  }
  loop ??= runLoop().finally(() => { loop = null; });
  return loop;
}

async function runLoop() {
  await ensureStore();
  st.refreshing = true;
  st.error = null; st.errorKind = null;
  emit();
  let retriedBlocked = false;
  try {
    for (;;) {
      const market = usMarketStatus();
      const now = Date.now();
      const order = [...priorityList.filter((s) => wanted.includes(s)), ...wanted.filter((s) => !priorityList.includes(s))];
      const todo = order.filter((s) => isStale(s, market.lastCompletedSession) && !(notFound[s] && now - notFound[s] < NOT_FOUND_MS));
      st.pending = todo;
      emit();
      if (!todo.length) break;
      const part = todo.slice(0, 7);
      const full = part.filter((s) => (store[s]?.rows?.length ?? 0) < FULL_BARS);
      const top = part.filter((s) => !full.includes(s));
      const results = [];
      if (full.length) results.push(await tdTimeSeries(full, { outputsize: 400 }));
      if (top.length) results.push(await tdTimeSeries(top, { outputsize: 10 }));
      let fatal = null, blocked = null, progressed = false;
      for (const { data, errors } of results) {
        for (const [sym, rows] of Object.entries(data)) { merge(sym, rows, market); progressed = true; }
        for (const [sym, err] of Object.entries(errors)) {
          if (err.kind === 'not-found' || err.kind === 'plan') notFound[sym] = Date.now();
          else if (['bad-key', 'day-limit', 'no-key'].includes(err.kind)) fatal = err;
          else if (err.kind === 'blocked' || err.kind === 'timeout') blocked = err;
        }
      }
      await persist();
      st.lastRefresh = Date.now();
      emit();
      if (fatal) { st.error = explainTdError(fatal); st.errorKind = fatal.kind; break; }
      if (blocked && !progressed) {
        if (retriedBlocked) { st.error = explainTdError(blocked); st.errorKind = blocked.kind; break; }
        retriedBlocked = true;
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }
      // A symbol that came back without fresh closed bars (e.g. a holiday quirk) must not loop forever.
      for (const s of part) if (isStale(s, market.lastCompletedSession) && !results.some((r) => r.errors[s])) notFound[s] = Date.now() - NOT_FOUND_MS + 3_600_000;
    }
  } finally {
    st.refreshing = false;
    st.pending = store ? wanted.filter((s) => isStale(s, usMarketStatus().lastCompletedSession)) : [];
    emit();
  }
}

// Live quotes during market hours only (no credits spent when closed).
export async function getStockQuotes(symbols) {
  const market = usMarketStatus();
  if (!market.open || !loadTdKey()) return { quotes: {}, marketOpen: market.open, errors: {} };
  const now = Date.now();
  const syms = [...new Set(symbols)];
  const quotes = {}, errors = {};
  for (const s of syms.slice(MAX_QUOTES)) errors[s] = new TdError('minute-limit', 'skipped');
  const need = [];
  for (const s of syms.slice(0, MAX_QUOTES)) {
    const c = quoteCache[s];
    if (c && now - c.at < QUOTE_TTL) quotes[s] = c.quote;
    else need.push(s);
  }
  if (need.length && tdUsage().usedToday <= 700) {
    const res = await tdQuotes(need);
    for (const [s, q] of Object.entries(res.quotes)) { quoteCache[s] = { at: now, quote: q }; quotes[s] = q; }
    Object.assign(errors, res.errors);
  }
  const anyOpen = Object.values(quotes).some((q) => q.isMarketOpen);
  return { quotes, marketOpen: Object.keys(quotes).length ? anyOpen || market.open : market.open, errors };
}

// Chart candles: stored closed bars plus, during market hours, today's bar from a cached quote.
export async function loadStockChart(sym) {
  await ensureStore();
  if (!store[sym]?.rows?.length && loadTdKey()) {
    const { data } = await tdTimeSeries([sym], { outputsize: 400 });
    if (data[sym]) { merge(sym, data[sym], usMarketStatus()); await persist(); }
  }
  const d1 = (store[sym]?.rows ?? []).map(unpack);
  const market = usMarketStatus();
  const q = quoteCache[sym]?.quote;
  if (market.open && q && d1.length) {
    const t = Date.UTC(...market.todayET.split('-').map((v, i) => (i === 1 ? +v - 1 : +v)));
    if (t > d1[d1.length - 1].time) d1.push({ time: t, date: market.todayET, open: q.open || q.price, high: Math.max(q.high || q.price, q.price), low: Math.min(q.low || q.price, q.price), close: q.price, volume: q.volume || 0 });
  }
  return { d1, h4: null };
}

// Long history for an in-browser backtest (1 credit per symbol, cached for 7 days).
export async function stockHistory(sym, bars = 2000) {
  const key = HIST_KEY + sym;
  const hit = await idbGet(key);
  if (hit?.at && Date.now() - hit.at < 7 * 86_400_000 && hit.rows?.length) return hit.rows.map(unpack);
  const { data, errors } = await tdTimeSeries([sym], { outputsize: Math.min(5000, bars) });
  if (!data[sym]) throw errors[sym] ?? new TdError('bad-data', 'No data');
  const rows = closedRows(data[sym], usMarketStatus()).map(pack);
  await idbSet(key, { at: Date.now(), rows });
  return rows.map(unpack);
}

// Market data for the Trading Desk, through the shared rate-limited Coinbase client.
//
// Daily candles only change once a day, so the desk keeps a saved copy of each
// coin's closed daily candles and asks Coinbase again only after a new day has
// closed. Live prices come from one request for all coins. A failed refresh
// falls back to the saved copy instead of stopping the desk.

import { getCandles, getPrices, TF_MS } from '../../lib/coinbaseMarket';
import { closedOnly } from '../chart/read';

export const TF = { '1D': { ms: TF_MS['1D'] }, '4H': { ms: TF_MS['4H'] } };

const STORE_KEY = 'pp_desk_daily_v1';
const KEEP_DAILY = 260;      // enough for the 200-day average plus the chart window
const DAY = TF_MS['1D'];

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') ?? {}; } catch { return {}; }
}

function saveStore(store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* storage full or private mode: keep in memory only */ }
}

const pack = (c) => [c.time, c.open, c.high, c.low, c.close, c.volume];
const unpack = ([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume });

let store = null; // sym → { fetchedAt, rows: closed daily candles (packed) }
const lastTry = {}; // sym → { at, kind } of the last download attempt (this tab)
const RETRY_MS = 10 * 60_000;
const NOT_LISTED_RETRY_MS = 6 * 3_600_000;

// Closed daily candles for every symbol, refreshing only what is out of date.
// → { daily: { SYM: candle[] }, forming: { SYM: price }, stale: { SYM: lastClosedTime }, errors: { SYM: MarketError } }
export async function loadDaily(symbols, now, onProgress) {
  store ??= loadStore();
  const lastClosedStart = Math.floor(now / DAY) * DAY - DAY; // start time of the most recent fully closed day
  const need = symbols.filter((s) => {
    const rows = store[s]?.rows;
    const tried = lastTry[s];
    if (tried?.kind === 'not-listed' && now - tried.at < NOT_LISTED_RETRY_MS) return false;
    if (!rows?.length) return true;
    if (rows[rows.length - 1][0] >= lastClosedStart) return false;
    // Out of date — but don't re-ask every few minutes if Coinbase just failed
    // or has not published yesterday's candle yet.
    return now - Math.max(tried?.at ?? 0, store[s].fetchedAt ?? 0) >= RETRY_MS;
  });

  const errors = {}, forming = {};
  let done = 0;
  onProgress?.(0, need.length);
  await Promise.all(need.map(async (sym) => {
    lastTry[sym] = { at: now, kind: null };
    try {
      const all = await getCandles(sym, '1D', KEEP_DAILY + 1);
      const closed = closedOnly(all, DAY, now);
      if (all.length > closed.length) forming[sym] = all[all.length - 1].close;
      store[sym] = { fetchedAt: now, rows: closed.slice(-KEEP_DAILY).map(pack) };
    } catch (e) {
      errors[sym] = e;
      lastTry[sym].kind = e?.kind ?? null;
    } finally {
      onProgress?.(++done, need.length);
    }
  }));
  if (need.length) saveStore(store);

  const daily = {}, stale = {};
  for (const sym of symbols) {
    const rows = store[sym]?.rows;
    if (!rows?.length) continue;
    daily[sym] = rows.map(unpack);
    const lastT = rows[rows.length - 1][0];
    if (lastT < lastClosedStart) stale[sym] = lastT;
  }
  return { daily, forming, stale, errors, refreshed: need.length - Object.keys(errors).length };
}

// Live prices for all symbols in one request; falls back to nothing (callers use the last close).
export async function loadPrices(symbols) {
  try { return await getPrices(symbols); } catch { return {}; }
}

// 4-hour candles (last one still forming), or null if Coinbase did not answer.
export async function load4h(sym) {
  try { return await getCandles(sym, '4H', 300); } catch { return null; }
}

// Candles for a chart: daily and 4-hour, each with the forming bar included.
export async function loadChartCandles(sym) {
  const [d1, h4] = await Promise.all([getCandles(sym, '1D', KEEP_DAILY + 1), load4h(sym)]);
  return { d1, h4 };
}

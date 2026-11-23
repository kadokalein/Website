// Coinbase public market data for the Trading Desk (no API key, CORS-open).
// Prices come only from Coinbase so that what the desk sees is what could be traded.

const BASE = 'https://api.coinbase.com/api/v3/brokerage/market/products';
const PAGE = 350; // Coinbase's per-request candle cap

export const TF = {
  '1D': { granularity: 'ONE_DAY', ms: 86_400_000 },
  '4H': { granularity: 'FOUR_HOUR', ms: 14_400_000 },
};

async function getJson(url, timeoutMs = 12_000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Candles oldest-first, INCLUDING the still-forming last bar (callers strip it
// with closedOnly before analysing). `bars` above 350 is fetched in pages.
export async function fetchCandles(symbol, tf, bars = PAGE) {
  const { granularity, ms } = TF[tf];
  const secs = ms / 1000;
  const byTime = new Map();
  let end = Math.floor(Date.now() / 1000);
  for (let remaining = bars; remaining > 0; remaining -= PAGE) {
    const n = Math.min(PAGE, remaining);
    const start = end - secs * (n - 1);
    const json = await getJson(`${BASE}/${symbol}-USD/candles?start=${start}&end=${end}&granularity=${granularity}&limit=${PAGE}`);
    const page = json.candles ?? [];
    for (const k of page) {
      const time = Number(k.start) * 1000;
      byTime.set(time, { time, open: +k.open, high: +k.high, low: +k.low, close: +k.close, volume: +k.volume });
    }
    if (page.length < n / 2) break; // ran out of history
    end = start - secs;
  }
  const out = [...byTime.values()].sort((a, b) => a.time - b.time);
  if (out.length < 30) throw new Error(`${symbol}: not enough candles`);
  return out;
}

// Run `fn` over items with at most `limit` in flight. Failures resolve to null.
export async function mapLimit(items, limit, fn, onProgress) {
  const out = new Array(items.length).fill(null);
  let next = 0, done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); } catch { out[i] = null; }
      onProgress?.(++done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

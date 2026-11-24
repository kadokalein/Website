// Candles for the scanner, coin cards and Live page — Coinbase only, through the
// shared rate-limited client (src/lib/coinbaseMarket.js). The old fallbacks
// (Binance, Bybit, Kraken) are blocked or CORS-refused in US browsers and priced
// coins on venues the owner cannot trade, so they were removed.

import { getCandles } from '../lib/coinbaseMarket';

const INTERVAL = { '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w' };

// → { candles: [{ time, open, high, low, close, volume }] oldest-first (last one still forming), interval }
export async function fetchCandles(symbol, timeframe) {
  const tf = INTERVAL[timeframe] ? timeframe : '4H';
  const candles = await getCandles(symbol, tf, 300);
  return { candles, interval: INTERVAL[tf] };
}

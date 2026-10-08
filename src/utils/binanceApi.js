// Binance public klines API — no API key required, no rate-limit issues for our volume
const BASE = 'https://api.binance.com/api/v3/klines';

const TF_MAP = {
  '1H': '1h',
  '4H': '4h',
  '1D': '1d',
  '1W': '1w',
};

// Binance uses SYMBOL+USDT pairs (e.g. BTC → BTCUSDT)
// A few coins use BUSD or have alternate names on Binance — handled here
const SYMBOL_MAP = {
  XRP:  'XRP',   // XRPUSDT
  DOGE: 'DOGE',  // DOGEUSDT
  // all others just use symbol directly
};

export async function fetchCandles(symbol, timeframe) {
  const interval = TF_MAP[timeframe] ?? '4h';
  const pair = (SYMBOL_MAP[symbol] ?? symbol) + 'USDT';
  const url = `${BASE}?symbol=${pair}&interval=${interval}&limit=500`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${res.status} for ${pair}`);
  const json = await res.json();

  // Binance returns an array of arrays or an error object
  if (!Array.isArray(json)) {
    throw new Error(json?.msg ?? 'Binance API error');
  }

  const candles = json
    .filter(k => Number(k[4]) > 0)
    .map(k => ({
      time:   k[0],           // open time in ms (already ms)
      open:   Number(k[1]),
      high:   Number(k[2]),
      low:    Number(k[3]),
      close:  Number(k[4]),
      volume: Number(k[5]),
    }));

  if (candles.length < 30) throw new Error(`Insufficient data for ${symbol}`);

  return { candles, interval };
}

// Multi-provider candle fetcher: tries Binance first, falls back to Bybit
// Both are public APIs with no key required and good CORS support.

const TF_MAP = {
  '1H': { binance: '1h',  bybit: '60'  },
  '4H': { binance: '4h',  bybit: '240' },
  '1D': { binance: '1d',  bybit: 'D'   },
  '1W': { binance: '1w',  bybit: 'W'   },
};

async function fromBinance(symbol, timeframe) {
  const interval = TF_MAP[timeframe]?.binance ?? '4h';
  const pair = symbol + 'USDT';
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=500`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(json?.msg ?? 'Binance bad response');
  const candles = json
    .filter(k => Number(k[4]) > 0)
    .map(k => ({
      time:   k[0],
      open:   Number(k[1]),
      high:   Number(k[2]),
      low:    Number(k[3]),
      close:  Number(k[4]),
      volume: Number(k[5]),
    }));
  if (candles.length < 30) throw new Error('Binance insufficient data');
  return candles;
}

async function fromBybit(symbol, timeframe) {
  const interval = TF_MAP[timeframe]?.bybit ?? '240';
  const pair = symbol + 'USDT';
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${pair}&interval=${interval}&limit=500`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Bybit HTTP ${res.status}`);
  const json = await res.json();
  if (json.retCode !== 0) throw new Error(json.retMsg ?? 'Bybit error');
  const list = json.result?.list ?? [];
  if (list.length < 30) throw new Error('Bybit insufficient data');
  // Bybit returns newest-first; reverse to get chronological order
  const candles = [...list].reverse().map(k => ({
    time:   Number(k[0]),
    open:   Number(k[1]),
    high:   Number(k[2]),
    low:    Number(k[3]),
    close:  Number(k[4]),
    volume: Number(k[5]),
  }));
  return candles;
}

export async function fetchCandles(symbol, timeframe) {
  const interval = TF_MAP[timeframe]?.binance ?? '4h';
  let lastError;

  // Try Binance first
  try {
    const candles = await fromBinance(symbol, timeframe);
    return { candles, interval };
  } catch (e) {
    lastError = e;
  }

  // Fall back to Bybit
  try {
    const candles = await fromBybit(symbol, timeframe);
    return { candles, interval };
  } catch (e) {
    lastError = e;
  }

  throw new Error(`All providers failed for ${symbol}: ${lastError?.message}`);
}

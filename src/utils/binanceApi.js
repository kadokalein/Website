// Multi-provider OHLCV fetcher.
// Tries Binance → Bybit → Kraken in order. First to succeed wins.
// Kraken is US-based and browser-accessible when exchange APIs are geo-blocked.

const TF = {
  '1H': { binance: '1h',  bybit: '60',  kraken: 60   },
  '4H': { binance: '4h',  bybit: '240', kraken: 240  },
  '1D': { binance: '1d',  bybit: 'D',   kraken: 1440 },
  '1W': { binance: '1w',  bybit: 'W',   kraken: 10080 },
};

// Kraken uses non-standard pair names; try the simple form first
function krakenPair(symbol) {
  const map = {
    BTC: 'XBTUSD', ETH: 'ETHUSD', SOL: 'SOLUSD', XRP: 'XRPUSD',
    DOGE: 'DOGEUSD', BNB: 'BNBUSD', ADA: 'ADAUSD', AVAX: 'AVAXUSD',
    DOT: 'DOTUSD', LINK: 'LINKUSD', LTC: 'LTCUSD', ATOM: 'ATOMUSD',
    UNI: 'UNIUSD', AAVE: 'AAVEUSD', NEAR: 'NEARUSD', MATIC: 'MATICUSD',
    TRX: 'TRXUSD', XLM: 'XLMUSD', FIL: 'FILUSD', GRT: 'GRTUSD',
    BCH: 'BCHUSD', VET: 'VETUSD', ALGO: 'ALGOUSD', ICP: 'ICPUSD',
    HBAR: 'HBARUSD', FLOW: 'FLOWUSD', MANA: 'MANAUSD', SAND: 'SANDUSD',
    CHZ: 'CHZUSD', AXS: 'AXSUSD', THETA: 'THETAUSD',
  };
  return map[symbol] ?? (symbol + 'USD');
}

async function fromBinance(symbol, timeframe) {
  const interval = TF[timeframe]?.binance ?? '4h';
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=500`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(json?.msg ?? 'Binance bad response');
  const candles = json.filter(k => Number(k[4]) > 0).map(k => ({
    time: k[0], open: Number(k[1]), high: Number(k[2]),
    low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
  }));
  if (candles.length < 30) throw new Error('Binance: insufficient data');
  return candles;
}

async function fromBybit(symbol, timeframe) {
  const interval = TF[timeframe]?.bybit ?? '240';
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}USDT&interval=${interval}&limit=500`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit HTTP ${res.status}`);
  const json = await res.json();
  if (json.retCode !== 0) throw new Error(json.retMsg ?? 'Bybit error');
  const list = json.result?.list ?? [];
  if (list.length < 30) throw new Error('Bybit: insufficient data');
  const candles = [...list].reverse().map(k => ({
    time: Number(k[0]), open: Number(k[1]), high: Number(k[2]),
    low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
  }));
  return candles;
}

async function fromKraken(symbol, timeframe) {
  const interval = TF[timeframe]?.kraken ?? 240;
  const pair = krakenPair(symbol);
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
  const json = await res.json();
  if (json.error?.length) throw new Error(json.error[0]);
  const key = Object.keys(json.result ?? {}).find(k => k !== 'last');
  if (!key) throw new Error('Kraken: no data key');
  const rows = json.result[key];
  if (!rows || rows.length < 30) throw new Error('Kraken: insufficient data');
  // Kraken: [time(s), open, high, low, close, vwap, volume, count]
  const candles = rows.map(k => ({
    time: Number(k[0]) * 1000, open: Number(k[1]), high: Number(k[2]),
    low: Number(k[3]), close: Number(k[4]), volume: Number(k[6]),
  }));
  return candles;
}

export async function fetchCandles(symbol, timeframe) {
  const interval = TF[timeframe]?.binance ?? '4h';
  const errors = [];

  for (const [name, fn] of [
    ['Binance', () => fromBinance(symbol, timeframe)],
    ['Bybit',   () => fromBybit(symbol, timeframe)],
    ['Kraken',  () => fromKraken(symbol, timeframe)],
  ]) {
    try {
      const candles = await fn();
      return { candles, interval };
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }

  throw new Error(errors[errors.length - 1] ?? 'All providers failed');
}

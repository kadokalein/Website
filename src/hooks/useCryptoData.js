import { useState, useEffect, useCallback, useRef } from 'react';
import { analyzeCandles } from '../utils/indicators';

// CryptoCompare public API — no key required, full CORS support on all browsers/iOS
const CC_BASE    = 'https://min-api.cryptocompare.com/data/v2';
const LIMIT      = 500;
const REFRESH_MS = 5_000;

// Map app timeframes → CryptoCompare endpoint + aggregate param
const TF_CONFIG = {
  '1H': { endpoint: 'histohour', aggregate: 1, interval: '1h' },
  '4H': { endpoint: 'histohour', aggregate: 4, interval: '4h' },
  '1D': { endpoint: 'histoday',  aggregate: 1, interval: '1d' },
  '1W': { endpoint: 'histoday',  aggregate: 7, interval: '1w' },
};

function parseCC(raw) {
  // Filter out future/empty candles CryptoCompare sometimes appends
  return raw
    .filter((k) => k.close > 0)
    .map((k) => ({
      time:   k.time * 1000,
      open:   k.open,
      high:   k.high,
      low:    k.low,
      close:  k.close,
      volume: k.volumefrom,
    }));
}

async function fetchCandles(symbol, timeframe) {
  const { endpoint, aggregate, interval } = TF_CONFIG[timeframe] ?? TF_CONFIG['1D'];
  const url = `${CC_BASE}/${endpoint}?fsym=${symbol}&tsym=USD&limit=${LIMIT}&aggregate=${aggregate}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = await res.json();
  if (json.Response === 'Error') throw new Error(json.Message ?? 'API error');
  return { candles: parseCC(json.Data.Data), interval };
}

export function useCoinData(coinSymbol, timeframe, refreshMs = REFRESH_MS) {
  const [state, setState] = useState({
    data: null,
    candles: null,
    loading: true,
    error: null,
    lastUpdated: null,
  });

  const paramsRef = useRef({ coinSymbol, timeframe });
  paramsRef.current = { coinSymbol, timeframe };

  const fetchData = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const { coinSymbol: sym, timeframe: tf } = paramsRef.current;
      const { candles, interval } = await fetchCandles(sym, tf);
      const analysis = analyzeCandles(candles, interval);
      setState({ data: analysis, candles, loading: false, error: null, lastUpdated: new Date() });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err.message ?? 'Failed to fetch data',
      }));
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, refreshMs);
    return () => clearInterval(timer);
  }, [fetchData, coinSymbol, timeframe, refreshMs]);

  return { ...state, refresh: fetchData };
}

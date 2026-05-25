import { useState, useEffect, useCallback, useRef } from 'react';
import { analyzeCandles } from '../utils/indicators';

const INTERVAL_MAP = { '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w' };
const CANDLE_LIMIT  = 500;
const REFRESH_MS    = 60_000;

function parseKlines(raw) {
  return raw.map((k) => ({
    time:   k[0],
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function fetchKlines(binanceSymbol, interval) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${CANDLE_LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error ${res.status}`);
  return parseKlines(await res.json());
}

export function useCoinData(binanceSymbol, timeframe) {
  const [state, setState] = useState({
    data: null,
    loading: true,
    error: null,
    lastUpdated: null,
  });

  const interval = INTERVAL_MAP[timeframe] ?? '1d';
  // Keep a ref so the interval callback always has the latest values
  const paramsRef = useRef({ binanceSymbol, interval });
  paramsRef.current = { binanceSymbol, interval };

  const fetchData = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const { binanceSymbol: sym, interval: iv } = paramsRef.current;
      const candles  = await fetchKlines(sym, iv);
      const analysis = analyzeCandles(candles, iv);
      setState({ data: analysis, loading: false, error: null, lastUpdated: new Date() });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err.message ?? 'Failed to fetch data',
      }));
    }
  }, []);  // stable — params read via ref

  // Re-fetch immediately when symbol/timeframe changes
  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchData, binanceSymbol, interval]);

  return { ...state, refresh: fetchData };
}

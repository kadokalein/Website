import { useState, useEffect, useCallback, useRef } from 'react';
import { analyzeCandles } from '../utils/indicators';
import { fetchCandles } from '../utils/binanceApi';

const REFRESH_MS = 5_000;

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

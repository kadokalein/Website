import { useState, useEffect, useCallback, useRef } from 'react';
import { analyzeCandles } from '../utils/indicators';
import { computeRunScore } from '../utils/scoring';
import { SCAN_UNIVERSE } from '../constants';

const CC_BASE        = 'https://min-api.cryptocompare.com/data/v2';
const LIMIT          = 500;
const REFRESH_MS     = 5 * 60 * 1000;
const BATCH_SIZE     = 5;
const BATCH_DELAY_MS = 300;

const TF_CONFIG = {
  '1H': { endpoint: 'histohour', aggregate: 1, interval: '1h' },
  '4H': { endpoint: 'histohour', aggregate: 4, interval: '4h' },
  '1D': { endpoint: 'histoday',  aggregate: 1, interval: '1d' },
  '1W': { endpoint: 'histoday',  aggregate: 7, interval: '1w' },
};

async function fetchCandles(symbol, timeframe) {
  const { endpoint, aggregate, interval } = TF_CONFIG[timeframe] ?? TF_CONFIG['1D'];
  const url = `${CC_BASE}/${endpoint}?fsym=${symbol}&tsym=USD&limit=${LIMIT}&aggregate=${aggregate}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.Response === 'Error') throw new Error(json.Message ?? 'API error');
  const candles = json.Data.Data
    .filter(k => k.close > 0)
    .map(k => ({ time: k.time * 1000, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volumefrom }));
  return { candles, interval };
}

const SIGNAL_ORDER = { 'BUY TRIGGERED': 0, 'WATCH': 1, 'LOW QUALITY': 2, 'NO SIGNAL': 3 };

export function useCryptoScanner(timeframe, topN = 6) {
  const [state, setState] = useState({
    topCoins: [],
    scanning: false,
    scanned: 0,
    total: SCAN_UNIVERSE.length,
    lastUpdated: null,
  });

  const timeframeRef = useRef(timeframe);
  timeframeRef.current = timeframe;
  const abortRef = useRef(false);

  const scan = useCallback(async () => {
    abortRef.current = false;
    setState(prev => ({ ...prev, scanning: true, scanned: 0 }));

    const scored = [];

    for (let i = 0; i < SCAN_UNIVERSE.length; i += BATCH_SIZE) {
      if (abortRef.current) return;

      const batch = SCAN_UNIVERSE.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async coin => {
          const { candles, interval } = await fetchCandles(coin.symbol, timeframeRef.current);
          const analysis = analyzeCandles(candles, interval);
          const runScore = computeRunScore(analysis);
          return { ...coin, runScore, analysis };
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled') scored.push(r.value);
      }

      setState(prev => ({ ...prev, scanned: Math.min(i + BATCH_SIZE, SCAN_UNIVERSE.length) }));

      if (i + BATCH_SIZE < SCAN_UNIVERSE.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    if (abortRef.current) return;

    // Sort: first by signal tier (BUY TRIGGERED > WATCH > LOW QUALITY > NO SIGNAL),
    // then by raw score within each tier.
    const topCoins = [...scored]
      .sort((a, b) => {
        const sigA = SIGNAL_ORDER[a.runScore?.signal] ?? 3;
        const sigB = SIGNAL_ORDER[b.runScore?.signal] ?? 3;
        if (sigA !== sigB) return sigA - sigB;
        return (b.runScore?.score ?? 0) - (a.runScore?.score ?? 0);
      })
      .slice(0, topN);

    setState({
      topCoins,
      scanning: false,
      scanned: SCAN_UNIVERSE.length,
      total: SCAN_UNIVERSE.length,
      lastUpdated: new Date(),
    });
  }, [topN]);

  useEffect(() => {
    scan();
    const timer = setInterval(scan, REFRESH_MS);
    return () => {
      abortRef.current = true;
      clearInterval(timer);
    };
  }, [scan, timeframe]);

  return { ...state, refresh: scan };
}

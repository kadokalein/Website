import { useState, useEffect, useCallback, useRef } from 'react';
import { analyzeCandles } from '../utils/indicators';
import { computeRunScore } from '../utils/scoring';
import { SCAN_UNIVERSE } from '../constants';
import { fetchCandles } from '../utils/binanceApi';

const REFRESH_MS     = 5 * 60 * 1000;
const BATCH_SIZE     = 5;
const BATCH_DELAY_MS = 200;

const SIGNAL_ORDER = { 'BUY TRIGGERED': 0, 'WATCH': 1, 'LOW QUALITY': 2, 'NO SIGNAL': 3 };

export function useCryptoScanner(timeframe, topN = 6) {
  const [state, setState] = useState({
    topCoins: [],
    scanning: false,
    scanned: 0,
    total: SCAN_UNIVERSE.length,
    lastUpdated: null,
    fetchErrors: 0,
    lastError: null,
  });

  const timeframeRef = useRef(timeframe);
  timeframeRef.current = timeframe;
  const abortRef = useRef(false);

  const scan = useCallback(async () => {
    abortRef.current = false;
    setState(prev => ({ ...prev, scanning: true, scanned: 0, fetchErrors: 0, lastError: null }));

    const scored = [];
    let errorCount = 0;
    let sampleError = null;

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
        if (r.status === 'fulfilled') {
          scored.push(r.value);
        } else {
          errorCount++;
          if (!sampleError) sampleError = r.reason?.message ?? String(r.reason);
        }
      }

      setState(prev => ({ ...prev, scanned: Math.min(i + BATCH_SIZE, SCAN_UNIVERSE.length), fetchErrors: errorCount }));

      if (i + BATCH_SIZE < SCAN_UNIVERSE.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    if (abortRef.current) return;

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
      fetchErrors: errorCount,
      lastError: sampleError,
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

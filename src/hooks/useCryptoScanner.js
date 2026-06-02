import { useState, useEffect, useCallback, useRef } from 'react';
import { analyzeCandles } from '../utils/indicators';
import { SCAN_UNIVERSE } from '../constants';

const CC_BASE    = 'https://min-api.cryptocompare.com/data/v2';
const LIMIT      = 500;
const REFRESH_MS = 5 * 60 * 1000; // re-scan every 5 minutes
const BATCH_SIZE = 5;
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

function scoreForRun(analysis) {
  if (!analysis) return -Infinity;
  // Base: conditions met (0–5), each worth 10 pts
  let score = (analysis.activeConditions ?? 0) * 10;

  // RSI bonus — more oversold = stronger bounce potential
  if (analysis.rsi != null) {
    if      (analysis.rsi < 25) score += 8;
    else if (analysis.rsi < 30) score += 5;
    else if (analysis.rsi < 35) score += 2;
  }

  // Bullish MACD crossover just happened
  if (analysis.macd?.isBullishCrossover) score += 4;

  // Volume spike = accumulation signal
  const ratio = analysis.volume?.ratio ?? 0;
  if      (ratio >= 2.5) score += 5;
  else if (ratio >= 1.5) score += 3;
  else if (ratio >= 1.2) score += 1;

  // Price at/below BB lower band
  if (analysis.conditions?.bbLower) score += 2;

  // Low volatility = safer risk/reward before a breakout
  if (analysis.volatility === 'low') score += 2;

  // Prefer coins that HAVEN'T already run (not overbought)
  if (analysis.rsi != null && analysis.rsi > 65) score -= 5;

  return score;
}

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
    const symbols = SCAN_UNIVERSE;

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      if (abortRef.current) return;

      const batch = symbols.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async coin => {
          const { candles, interval } = await fetchCandles(coin.symbol, timeframeRef.current);
          const analysis = analyzeCandles(candles, interval);
          return { ...coin, score: scoreForRun(analysis), analysis };
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled') scored.push(r.value);
      }

      setState(prev => ({ ...prev, scanned: Math.min(i + BATCH_SIZE, symbols.length) }));

      if (i + BATCH_SIZE < symbols.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    if (abortRef.current) return;

    const topCoins = [...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    setState({
      topCoins,
      scanning: false,
      scanned: symbols.length,
      total: symbols.length,
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

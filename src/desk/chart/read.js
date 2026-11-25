// One "read" of an asset's chart: everything the Scout and Analyst look at,
// computed once from CLOSED candles. The daily frame is required; the 4-hour
// frame is optional detail (null when not supplied).

import { emaSeries, smaSeries, atrSeries, rsiSeries, adxSeries, bbWidthSeries, percentRank, highest, lowest, last } from './ta.js';
import { findPivots, findLevels, fitTrendline, marketStructure, classifyShape } from './lines.js';
import { calcMACD } from '../../utils/indicators.js';

export const RANGE_DAYS = 20;   // the box whose edges are the breakout / breakdown lines
export const EXIT_DAYS = 10;    // trailing exit channel
const D1_WINDOW = 150;
const H4_WINDOW = 240;

// opts.rangeDays / opts.exitDays override the breakout box and trailing-exit lengths
// (stocks use different ones than crypto).
export function readChart(d1, h4 = null, { rangeDays = RANGE_DAYS, exitDays = EXIT_DAYS } = {}) {
  if (!d1 || d1.length < 60) return null;
  const n = d1.length;
  const bar = d1[n - 1];
  const closes = d1.map((c) => c.close);
  const close = bar.close;

  const atrS = atrSeries(d1, 20);
  const atr = last(atrS);
  const ema20 = last(emaSeries(closes, 20));
  const ema50S = emaSeries(closes, 50);
  const ema50 = last(ema50S);
  const sma200S = smaSeries(closes, 200);
  const sma200 = last(sma200S);
  const sma200Prev = sma200S[n - 23] ?? null; // ~one month earlier
  const sma150 = last(smaSeries(closes, 150));
  const sma50 = last(smaSeries(closes, 50));
  const rsiS = rsiSeries(d1, 14);
  const adxS = adxSeries(d1, 14);
  const bbw = bbWidthSeries(d1, 20, 2);

  // The box: highs/lows of the RANGE_DAYS days BEFORE the latest closed day.
  const rangeHigh = highest(d1, n - 1 - rangeDays, n - 2);
  const rangeLow = lowest(d1, n - 1 - rangeDays, n - 2);
  // Trailing-exit channel includes the latest day (it applies from tomorrow).
  const exitLow = lowest(d1, n - exitDays, n - 1);
  const exitHigh = highest(d1, n - exitDays, n - 1);
  // The channel the latest close is judged against (the EXIT_DAYS days before it).
  const exitLowPrev = lowest(d1, n - 1 - exitDays, n - 2);
  const exitHighPrev = highest(d1, n - 1 - exitDays, n - 2);
  // 52-week (≈252 trading days, or 365 crypto days) extremes, using what history there is.
  const yearBars = Math.min(n, 252);
  const high52 = highest(d1, n - yearBars, n - 1);
  const low52 = lowest(d1, n - yearBars, n - 1, 'low');

  let volAvg = 0;
  for (let i = n - 21; i < n - 1; i++) volAvg += d1[i].volume;
  volAvg /= 20;

  const w = d1.slice(-D1_WINDOW);
  const pivots = findPivots(w, 2, 2);
  const tol = Math.max(0.5 * atr, 0.01 * close);
  const levels = findLevels(w, pivots, tol);
  const support = fitTrendline(w, pivots, 'support', 0.35 * atr, { minSpan: 7, maxSlopePctPerBar: 4 });
  const resistance = fitTrendline(w, pivots, 'resistance', 0.35 * atr, { minSpan: 7, maxSlopePctPerBar: 4 });
  const structure = marketStructure(pivots);

  let trend = 'flat';
  if (close > ema50 && ema20 > ema50) trend = 'up';
  else if (close < ema50 && ema20 < ema50) trend = 'down';

  const ret = (bars) => (n > bars ? (close / closes[n - 1 - bars] - 1) * 100 : null);

  const read = {
    price: close,
    time: bar.time,
    d1: {
      bar, prevClose: closes[n - 2],
      atr, atrPct: (atr / close) * 100,
      ema20, ema50, sma200, sma200Prev, sma150, sma50, trend, high52, low52, rangeDays, exitDays,
      rsi: last(rsiS), adx: last(adxS.adx), adxPrev: adxS.adx[n - 4],
      macd: calcMACD(d1),
      bbwRankBefore: percentRank(bbw.slice(0, -1), 120), // compression going INTO the latest bar
      volRatio: volAvg > 0 ? bar.volume / volAvg : 0,
      rangeHigh, rangeLow, exitLow, exitHigh, exitLowPrev, exitHighPrev,
      pivots, levels, support, resistance, structure,
      shape: classifyShape(support, resistance, 0.15),
      window: w, offset: n - w.length, tol,
      ret7: ret(7), ret30: ret(30),
    },
    h4: null,
  };

  if (h4 && h4.length >= 120) {
    const m = h4.length;
    const hc = h4.map((c) => c.close);
    const atr4 = last(atrSeries(h4, 14));
    const w4 = h4.slice(-H4_WINDOW);
    const piv4 = findPivots(w4, 3, 3);
    const tol4 = Math.max(0.5 * atr4, 0.004 * last(hc));
    const sup4 = fitTrendline(w4, piv4, 'support', 0.35 * atr4);
    const res4 = fitTrendline(w4, piv4, 'resistance', 0.35 * atr4);
    read.price = last(hc);
    read.time = h4[m - 1].time;
    read.h4 = {
      atr: atr4,
      ema20: last(emaSeries(hc, 20)), ema50: last(emaSeries(hc, 50)),
      rsi: last(rsiSeries(h4, 14)),
      pivots: piv4, levels: findLevels(w4, piv4, tol4), support: sup4, resistance: res4,
      structure: marketStructure(piv4), shape: classifyShape(sup4, res4),
      window: w4, offset: m - w4.length, tol: tol4,
    };
  }
  return read;
}

// Keep only candles that have fully closed as of `now` (ms).
export function closedOnly(candles, barMs, now) {
  let end = candles.length;
  while (end > 0 && candles[end - 1].time + barMs > now) end--;
  return end === candles.length ? candles : candles.slice(0, end);
}

// Technical indicator calculations — all pure functions operating on candle arrays.
// Candle shape: { open, high, low, close, volume, time }

const BARS_PER_YEAR = { '1h': 8760, '4h': 2190, '1d': 365, '1w': 52 };

// How many bars correspond to N calendar days for each timeframe
const DAYS_TO_BARS = {
  '1h': (d) => d * 24,
  '4h': (d) => d * 6,
  '1d': (d) => d,
  '1w': (d) => Math.ceil(d / 7),
};

// --- ATR (Wilder's smoothing) ---

function calcTrueRanges(candles) {
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return trs;
}

export function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return [];
  const trs = calcTrueRanges(candles);
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const atrs = [atr];
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    atrs.push(atr);
  }
  return atrs;
}

// ATR percentile rank within a rolling lookback window (0–100)
export function calcATRPercentile(atrs, lookback = 100) {
  const window = atrs.slice(-Math.min(lookback, atrs.length));
  if (window.length === 0) return 50;
  const current = window[window.length - 1];
  const sorted = [...window].sort((a, b) => a - b);
  let rank = 0;
  for (const v of sorted) { if (v < current) rank++; }
  return (rank / window.length) * 100;
}

// --- Bollinger Bands (SMA ± N×StdDev) ---

export function calcBollingerBands(candles, period = 20, multiplier = 2) {
  if (candles.length < period) return [];
  const closes = candles.map((c) => c.close);
  const result = [];
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((s, v) => s + v, 0) / period;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    const upper = mean + multiplier * stdDev;
    const lower = mean - multiplier * stdDev;
    result.push({ upper, middle: mean, lower, bbw: (upper - lower) / mean * 100, stdDev });
  }
  return result;
}

// BBW percentile rank within a rolling lookback window
export function calcBBWPercentile(bbs, lookback = 180) {
  const window = bbs.slice(-Math.min(lookback, bbs.length));
  if (window.length === 0) return 50;
  const current = window[window.length - 1].bbw;
  const sorted = window.map((b) => b.bbw).sort((a, b) => a - b);
  let rank = 0;
  for (const v of sorted) { if (v < current) rank++; }
  return (rank / window.length) * 100;
}

// --- Historical / Realized Volatility (annualized %) ---
// barsLookback: number of candles to use; barsPerYear: annualization factor

export function calcHV(candles, barsLookback, barsPerYear) {
  if (candles.length < barsLookback + 1) return null;
  const closes = candles.slice(-(barsLookback + 1)).map((c) => c.close);
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(barsPerYear) * 100;
}

// --- Rate of Change ---

export function calcROC(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const closes = candles.map((c) => c.close);
  const current = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - period];
  return ((current - prev) / prev) * 100;
}

// --- RSI (Wilder's smoothing, 14-period) ---

export function calcRSI(candles, period = 14) {
  if (candles.length < period + 2) return null;
  const closes = candles.map((c) => c.close);
  const changes = closes.slice(1).map((c, i) => c - closes[i]);

  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(0, changes[i])) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -changes[i])) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// Full RSI series — needed for Stochastic RSI
export function calcRSISeries(candles, period = 14) {
  if (candles.length < period + 2) return [];
  const closes = candles.map((c) => c.close);
  const changes = closes.slice(1).map((c, i) => c - closes[i]);

  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  const out = [avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)];
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(0, changes[i])) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -changes[i])) / period;
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

// Stochastic RSI — applies stochastic formula to RSI series, then smooths.
// Returns { k, d, oversold, overbought, bullishCross } or null.
// Used by most profitable open-source crypto bots (Freqtrade BB_RSI, etc.)
export function calcStochRSI(candles, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
  const rsiSeries = calcRSISeries(candles, rsiPeriod);
  if (rsiSeries.length < stochPeriod + kSmooth + dSmooth) return null;

  const rawStoch = [];
  for (let i = stochPeriod - 1; i < rsiSeries.length; i++) {
    const window = rsiSeries.slice(i - stochPeriod + 1, i + 1);
    const lo = Math.min(...window);
    const hi = Math.max(...window);
    rawStoch.push(hi === lo ? 0.5 : (rsiSeries[i] - lo) / (hi - lo));
  }

  const kArr = [];
  for (let i = kSmooth - 1; i < rawStoch.length; i++) {
    const s = rawStoch.slice(i - kSmooth + 1, i + 1);
    kArr.push((s.reduce((a, v) => a + v, 0) / kSmooth) * 100);
  }

  if (kArr.length < dSmooth) return null;
  const dArr = [];
  for (let i = dSmooth - 1; i < kArr.length; i++) {
    const s = kArr.slice(i - dSmooth + 1, i + 1);
    dArr.push(s.reduce((a, v) => a + v, 0) / dSmooth);
  }

  const k     = kArr[kArr.length - 1];
  const d     = dArr[dArr.length - 1];
  const prevK = kArr.length >= 2 ? kArr[kArr.length - 2] : k;
  const prevD = dArr.length >= 2 ? dArr[dArr.length - 2] : d;

  return {
    k, d,
    oversold:    k < 20,
    overbought:  k > 80,
    bullishCross: prevK < prevD && k >= d,
    bearishCross: prevK > prevD && k <= d,
  };
}

// --- EMA helper (seeds with SMA of first `period` values) ---

export function calcEMA(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const emas = [ema];
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    emas.push(ema);
  }
  return emas;
}

// --- MACD (12/26/9) ---

export function calcMACD(candles, fast = 12, slow = 26, signal = 9) {
  if (candles.length < slow + signal + 1) return null;
  const closes = candles.map((c) => c.close);

  const fastEMA = calcEMA(closes, fast);
  const slowEMA = calcEMA(closes, slow);

  const offset = slow - fast;
  const macdLine = slowEMA.map((s, i) => fastEMA[i + offset] - s);

  if (macdLine.length < signal) return null;
  const signalLine = calcEMA(macdLine, signal);
  const macdOffset = macdLine.length - signalLine.length;

  // Check last 3 bars for a bullish crossover (MACD crosses above signal)
  let isBullishCrossover = false;
  for (let i = Math.max(1, signalLine.length - 3); i < signalLine.length; i++) {
    const prevM = macdLine[i - 1 + macdOffset];
    const currM = macdLine[i + macdOffset];
    const prevS = signalLine[i - 1];
    const currS = signalLine[i];
    if (prevM < prevS && currM >= currS) { isBullishCrossover = true; break; }
  }

  const lastMACD   = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  const lastHist   = lastMACD - lastSignal;
  const prevHist   = signalLine.length >= 2
    ? macdLine[macdLine.length - 2] - signalLine[signalLine.length - 2]
    : lastHist;

  return {
    macd: lastMACD,
    signal: lastSignal,
    histogram: lastHist,
    status: lastMACD > lastSignal ? 'bullish' : lastMACD < lastSignal ? 'bearish' : 'neutral',
    isBullishCrossover,
    isHistogramRising: lastHist > prevHist,
  };
}

// --- Volume ratio vs N-period average ---

export function calcVolumeRatio(candles, period = 20) {
  if (candles.length < period + 1) return null;
  const vols = candles.map((c) => c.volume);
  const current = vols[vols.length - 1];
  const avg = vols.slice(-period - 1, -1).reduce((s, v) => s + v, 0) / period;
  return { current, avg, ratio: avg > 0 ? current / avg : 0 };
}

// --- Master analysis function ---
// Returns all indicator values for a candle series plus derived signals.

export function analyzeCandles(candles, interval = '1d') {
  if (!candles || candles.length < 40) return null;

  const barsPerYear = BARS_PER_YEAR[interval] ?? 365;
  const daysToBar = DAYS_TO_BARS[interval] ?? ((d) => d);
  const currentPrice = candles[candles.length - 1].close;

  // ATR
  const atrs = calcATR(candles, 14);
  if (atrs.length < 2) return null;
  const currentATR = atrs[atrs.length - 1];
  const atrPercentile = calcATRPercentile(atrs, 100);

  // Bollinger Bands
  const bbs = calcBollingerBands(candles, 20, 2);
  if (bbs.length === 0) return null;
  const lastBB = bbs[bbs.length - 1];
  const bbwPercentile = calcBBWPercentile(bbs, 180);

  // Historical Volatility (annualized) for 7/30/90 day equivalents
  const hv7  = calcHV(candles, daysToBar(7),  barsPerYear);
  const hv30 = calcHV(candles, daysToBar(30), barsPerYear);
  const hv90 = calcHV(candles, daysToBar(90), barsPerYear);

  // ROC, RSI, StochRSI, MACD, Volume
  const roc        = calcROC(candles, 14);
  const rsi        = calcRSI(candles, 14);
  const stochRSI   = calcStochRSI(candles);
  const rsiPrev    = calcRSI(candles.slice(0, -1), 14);
  const rsiTrend   = rsi != null && rsiPrev != null
    ? (rsi > rsiPrev ? 'rising' : rsi < rsiPrev ? 'falling' : 'flat')
    : null;
  const macd       = calcMACD(candles);
  const volumeData = calcVolumeRatio(candles, 20);

  // Detect if volume JUST crossed the 2× threshold this bar (state change)
  const prevVol = candles.length >= 2 ? candles[candles.length - 2].volume : null;
  const volumeJustSpiked = volumeData != null && prevVol != null
    && volumeData.ratio >= 2.0
    && (volumeData.avg > 0 ? prevVol / volumeData.avg < 2.0 : false);

  // Entry zones: price minus ATR multiples
  const conservativeEntry = currentPrice - 1.5 * currentATR;
  const aggressiveEntry   = currentPrice - 2   * currentATR;

  // Swing high over last 20 bars — used to determine ATR support condition
  const recentHigh = Math.max(...candles.slice(-20).map((c) => c.high));
  // Highest CLOSE of previous 20 bars (excluding the latest) — used for breakout detection
  const prevRecentHigh = candles.length >= 21
    ? Math.max(...candles.slice(-21, -1).map((c) => c.close))
    : null;

  // Volatility classification driven by ATR percentile rank
  let volatility;
  if      (atrPercentile < 20) volatility = 'low';
  else if (atrPercentile > 80) volatility = 'high';
  else                          volatility = 'medium';

  // Five entry conditions
  const conditions = {
    atrSupport:  currentPrice <= recentHigh - 1.5 * currentATR,
    bbLower:     currentPrice <= lastBB.lower * 1.005,
    rsiOversold: rsi    !== null && rsi < 35,
    macdCross:   macd   !== null && macd.isBullishCrossover,
    volumeHigh:  volumeData !== null && volumeData.ratio >= 1.2,
  };

  const activeConditions = Object.values(conditions).filter(Boolean).length;

  // EMA trend context — used to distinguish uptrends from downtrends before entry
  const closePrices = candles.map(c => c.close);
  const ema20arr    = calcEMA(closePrices, 20);
  const ema50arr    = calcEMA(closePrices, 50);
  const ema200arr   = calcEMA(closePrices, 200);
  const ema20       = ema20arr.length  ? ema20arr[ema20arr.length - 1]  : null;
  const ema50       = ema50arr.length  ? ema50arr[ema50arr.length - 1]  : null;
  const ema200      = ema200arr.length ? ema200arr[ema200arr.length - 1]: null;
  const prevEma20   = ema20arr.length  > 1 ? ema20arr[ema20arr.length - 2]  : null;
  const prevEma50   = ema50arr.length  > 1 ? ema50arr[ema50arr.length - 2]  : null;
  // 'up' = EMA20 above EMA50 (uptrend / golden cross context)
  const emaTrend    = ema20 != null && ema50 != null ? (ema20 > ema50 ? 'up' : 'down') : null;
  const emaGoldenCross = prevEma20 != null && prevEma50 != null
    && ema20 != null && ema50 != null
    && ema20 > ema50 && prevEma20 <= prevEma50;

  return {
    currentPrice,
    atr: currentATR,
    atrPercentile,
    volatility,
    bb:            lastBB,
    bbwPercentile,
    isCompressed:  bbwPercentile < 20,
    hv7, hv30, hv90,
    roc,
    rsi,
    rsiPrev,
    rsiTrend,
    macd,
    stochRSI,
    volume:            volumeData,
    volumeJustSpiked,
    conservativeEntry,
    aggressiveEntry,
    conditions,
    activeConditions,
    entrySignal:   activeConditions >= 3,
    ema20, ema50, ema200, emaTrend, emaGoldenCross,
    prevRecentHigh,
  };
}

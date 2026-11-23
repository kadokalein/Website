// Index-aligned indicator series for the Trading Desk.
// Every series has the same length as its input; warm-up slots are null.
// Candle shape: { time, open, high, low, close, volume }.

export function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let e = 0;
  for (let i = 0; i < period; i++) e += values[i];
  e /= period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

export function smaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// Wilder ATR
export function atrSeries(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  let atr = 0;
  for (let i = 1; i <= period; i++) atr += trueRange(candles, i);
  atr /= period;
  out[period] = atr;
  for (let i = period + 1; i < candles.length; i++) {
    atr = (atr * (period - 1) + trueRange(candles, i)) / period;
    out[i] = atr;
  }
  return out;
}

function trueRange(candles, i) {
  const { high, low } = candles[i];
  const pc = candles[i - 1].close;
  return Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc));
}

// Wilder RSI
export function rsiSeries(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

// Wilder ADX with +DI / -DI
export function adxSeries(candles, period = 14) {
  const n = candles.length;
  const adx = new Array(n).fill(null), plusDI = new Array(n).fill(null), minusDI = new Array(n).fill(null);
  if (n < period * 2 + 1) return { adx, plusDI, minusDI };
  let tr = 0, pdm = 0, mdm = 0;
  const dm = (i) => {
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    return [up > dn && up > 0 ? up : 0, dn > up && dn > 0 ? dn : 0];
  };
  for (let i = 1; i <= period; i++) {
    const [p, m] = dm(i);
    tr += trueRange(candles, i); pdm += p; mdm += m;
  }
  let dxSum = 0, prevAdx = null;
  for (let i = period; i < n; i++) {
    if (i > period) {
      const [p, m] = dm(i);
      tr = tr - tr / period + trueRange(candles, i);
      pdm = pdm - pdm / period + p;
      mdm = mdm - mdm / period + m;
    }
    const pdi = tr > 0 ? (100 * pdm) / tr : 0;
    const mdi = tr > 0 ? (100 * mdm) / tr : 0;
    plusDI[i] = pdi; minusDI[i] = mdi;
    const dx = pdi + mdi > 0 ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
    if (i < period * 2 - 1) dxSum += dx;
    else if (i === period * 2 - 1) { dxSum += dx; prevAdx = dxSum / period; adx[i] = prevAdx; }
    else { prevAdx = (prevAdx * (period - 1) + dx) / period; adx[i] = prevAdx; }
  }
  return { adx, plusDI, minusDI };
}

// Bollinger band width as % of the middle band
export function bbWidthSeries(candles, period = 20, mult = 2) {
  const out = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    let mean = 0;
    for (let j = i - period + 1; j <= i; j++) mean += candles[j].close;
    mean /= period;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (candles[j].close - mean) ** 2;
    out[i] = mean > 0 ? (2 * mult * Math.sqrt(v / period)) / mean * 100 : null;
  }
  return out;
}

// Percentile rank (0-100) of the last non-null value within the trailing `lookback` values
export function percentRank(series, lookback = 120) {
  const vals = [];
  for (let i = series.length - 1; i >= 0 && vals.length < lookback; i--) {
    if (series[i] != null) vals.push(series[i]);
  }
  if (vals.length < 5) return 50;
  const cur = vals[0];
  let below = 0;
  for (const v of vals) if (v < cur) below++;
  return (below / vals.length) * 100;
}

export function highest(candles, from, to, key = 'high') {
  let m = -Infinity;
  for (let i = Math.max(0, from); i <= Math.min(candles.length - 1, to); i++) m = Math.max(m, candles[i][key]);
  return m;
}

export function lowest(candles, from, to, key = 'low') {
  let m = Infinity;
  for (let i = Math.max(0, from); i <= Math.min(candles.length - 1, to); i++) m = Math.min(m, candles[i][key]);
  return m;
}

export const last = (arr) => arr[arr.length - 1];

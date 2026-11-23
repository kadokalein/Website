// Agent 2 — Scout. A quick look at each chart with the lines drawn: is price
// breaking out of its 20-day box in the direction the Briefing allows?
//
//   OPEN  — the latest daily candle CLOSED through the line: hand to the Analyst now
//   WATCH — price is within reach of the line; save it and re-check for up to 7 days
//   PASS  — nothing to do

import { nearestAbove, nearestBelow } from '../chart/lines.js';
import { RANGE_DAYS } from '../chart/read.js';

export const WATCH_DAYS = 7;
const DAY = 86_400_000;

// Horizontal zone (from clustered swing pivots) sitting on a price, if any.
export function zoneAt(read, price) {
  const tol = read.d1.atr;
  return read.d1.levels
    .filter((z) => Math.abs(z.price - price) <= tol)
    .sort((a, b) => b.strength - a.strength)[0] ?? null;
}

export function describeLines(read) {
  const d = read.d1;
  const out = [];
  const sup = nearestBelow(d.levels, read.price), res = nearestAbove(d.levels, read.price);
  if (res) out.push(`Resistance zone ${fmt(res.price)} (${res.touches} touches)`);
  if (sup) out.push(`Support zone ${fmt(sup.price)} (${sup.touches} touches)`);
  if (d.resistance) out.push(`${d.resistance.slope < 0 ? 'Falling' : 'Rising'} trendline over the highs at ${fmt(d.resistance.valueNow)}${d.resistance.brokenAt != null ? ' — broken' : ''}`);
  if (d.support) out.push(`${d.support.slope > 0 ? 'Rising' : 'Falling'} trendline under the lows at ${fmt(d.support.valueNow)}${d.support.brokenAt != null ? ' — broken' : ''}`);
  if (d.shape) out.push(`Shape: ${d.shape.name}`);
  if (d.structure.trend !== 'unknown') out.push(`Swing structure: ${d.structure.trend === 'up' ? 'higher highs & higher lows' : d.structure.trend === 'down' ? 'lower highs & lower lows' : 'mixed (range)'}`);
  return out;
}

export function fmt(p) {
  if (p == null) return '—';
  if (p >= 1000) return p.toFixed(0);
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toPrecision(3);
}

// The same indicators the scanner has always shown, read on closed daily candles.
function indicatorSnapshot(read) {
  const d = read.d1;
  return {
    rsi: d.rsi, macd: d.macd?.status ?? null, volRatio: d.volRatio, adx: d.adx,
    atrPct: d.atrPct, bbwRank: d.bbwRankBefore, trend: d.trend,
  };
}

// read: readChart(...) for this asset. brief: buildBriefing(...).
export function scout({ sym, read, brief, now }) {
  const base = { sym, time: now, price: read?.price ?? null, indicators: read ? indicatorSnapshot(read) : null, lines: read ? describeLines(read) : [] };
  if (!read) return { ...base, verdict: 'PASS', reason: 'Not enough price history' };

  const d = read.d1;
  const close = d.bar.close;
  const brokeUp = close > d.rangeHigh && close > d.ema50;
  const brokeDown = close < d.rangeLow && close < d.ema50;

  if (brokeUp || brokeDown) {
    const dir = brokeUp ? 1 : -1;
    const level = brokeUp ? d.rangeHigh : d.rangeLow;
    const allowed = dir > 0 ? brief.allowLong : brief.allowShort;
    const what = `Daily close ${brokeUp ? 'above' : 'below'} the ${RANGE_DAYS}-day range ${brokeUp ? 'high' : 'low'} at ${fmt(level)}`;
    if (!allowed) {
      const why = dir < 0 && !brief.shortsEnabled ? 'a short signal, but paper shorts are switched off'
        : `but the Briefing is not allowing ${dir > 0 ? 'longs' : 'shorts'} in this market regime`;
      return { ...base, verdict: 'PASS', dir, level, reason: `${what} — ${why}` };
    }
    return { ...base, verdict: 'OPEN', dir, level, setup: brokeUp ? 'breakout' : 'breakdown', reason: what };
  }

  // Not through the line yet — is it close enough that a break within a week is plausible?
  const reach = Math.max(d.atr, 0.04 * close);
  if (brief.allowLong && close > d.ema50 && d.rangeHigh - close <= reach) {
    return {
      ...base, verdict: 'WATCH', dir: 1, level: d.rangeHigh, setup: 'breakout',
      reason: `${((d.rangeHigh / close - 1) * 100).toFixed(1)}% below its ${RANGE_DAYS}-day range high`,
      trigger: `a daily close above ${fmt(d.rangeHigh)}`, expires: now + WATCH_DAYS * DAY,
    };
  }
  if (brief.allowShort && close < d.ema50 && close - d.rangeLow <= reach) {
    return {
      ...base, verdict: 'WATCH', dir: -1, level: d.rangeLow, setup: 'breakdown',
      reason: `${((1 - d.rangeLow / close) * 100).toFixed(1)}% above its ${RANGE_DAYS}-day range low`,
      trigger: `a daily close below ${fmt(d.rangeLow)}`, expires: now + WATCH_DAYS * DAY,
    };
  }
  return { ...base, verdict: 'PASS', reason: 'Price is mid-range — no line in play' };
}

// Agent 3 — Analyst. Takes a Scout candidate and does the full chart work-up:
// trend on two timeframes, the quality of the line being broken, volume, momentum,
// relative strength, room to the next obstacle, and — decisively — whether the
// trade can pay for Coinbase's fees. Outputs BUY, SHORT or REJECT with a plan.
//
// The "must pass" checks decide. The rest of the checklist is the supporting chart
// work, shown so the reasoning is inspectable: in backtests no single one of those
// items reliably separated winners from losers, so they inform but do not veto.

import { nearestAbove, nearestBelow } from '../chart/lines.js';
import { EXIT_DAYS } from '../chart/read.js';
import { zoneAt, fmt } from './scout.js';

export const ANALYST_DEFAULTS = {
  stopAtr: 3,            // initial stop: this many daily ATRs from entry
  minStopPct: 5.5,       // stop must be ≥ ~3× the round-trip cost, or fees dominate the trade
  maxStopPct: 25,        // wider than this = too volatile to size sensibly
  maxChaseAtr: 1.0,      // live price may not have run more than this past the signal close
};

export function analyze({ sym, read, brief, candidate, btcRead = null, fees, livePrice = null, config = ANALYST_DEFAULTS }) {
  const d = read.d1;
  const dir = candidate.dir;
  const long = dir > 0;
  const close = d.bar.close;
  const price = livePrice ?? close;
  const level = candidate.level;
  const roundTrip = (fees.taker * 2 + fees.slippage * 2) * 100;

  const must = [], scored = [];
  const add = (list, name, pass, detail) => list.push({ name, pass: !!pass, detail });

  // ── Must pass ──────────────────────────────────────────────────────────────
  add(must, 'Market regime', long ? brief.allowLong : brief.allowShort,
    `Bitcoin ${brief.regime.phase === 'bull' ? 'above' : 'below'} its ${brief.regime.anchorLabel ?? 'long-term average'} → ${brief.regime.phase === 'bull' ? 'longs' : 'shorts'} only`);
  add(must, 'Closed through the line', long ? close > level : close < level,
    `Daily close ${fmt(close)} vs ${long ? 'range high' : 'range low'} ${fmt(level)}`);
  add(must, 'Trend filter', long ? close > d.ema50 : close < d.ema50,
    `Price ${long ? 'above' : 'below'} the 50-day EMA (${fmt(d.ema50)})`);

  const stopDist = config.stopAtr * d.atr;
  const stopPct = (stopDist / price) * 100;
  add(must, 'Fees are affordable', stopPct >= config.minStopPct,
    `Risk per unit ${stopPct.toFixed(1)}% vs ${roundTrip.toFixed(1)}% round-trip cost — fees are ${(roundTrip / stopPct).toFixed(2)}R`);
  add(must, 'Volatility is sizeable', stopPct <= config.maxStopPct, `Stop distance ${stopPct.toFixed(1)}% (max ${config.maxStopPct}%)`);
  const chase = (dir * (price - close)) / d.atr;
  add(must, 'Not chasing', chase <= config.maxChaseAtr && dir * (price - level) > 0,
    `Live price ${fmt(price)} is ${chase.toFixed(2)} ATR past the signal close and ${dir * (price - level) > 0 ? 'still beyond' : 'back inside'} the line`);

  // ── Scored: the chart work-up ──────────────────────────────────────────────
  const zone = zoneAt(read, level);
  add(scored, 'Line quality', zone && zone.touches >= 3,
    zone ? `${zone.touches} swing touches at ${fmt(zone.price)}${zone.roleReversal ? ', acted as both support and resistance' : ''}` : 'No clustered swing points at the line');

  const st = d.structure.trend;
  add(scored, 'Daily swing structure', long ? st === 'up' : st === 'down',
    st === 'up' ? 'Higher highs and higher lows' : st === 'down' ? 'Lower highs and lower lows' : 'Mixed — no clean sequence');

  if (read.h4) {
    const s4 = read.h4.structure.trend;
    add(scored, '4-hour structure', long ? s4 === 'up' : s4 === 'down',
      s4 === 'up' ? 'Higher highs and higher lows on 4H' : s4 === 'down' ? 'Lower highs and lower lows on 4H' : 'Mixed on 4H');
  }

  const tl = long ? d.resistance : d.support;
  const brokeTrendline = tl && tl.brokenAt != null && d.window.length - 1 - tl.brokenAt <= 5 && (long ? tl.slope <= 0 : tl.slope >= 0);
  const riding = long ? d.support && d.support.brokenAt == null && d.support.slope > 0 : d.resistance && d.resistance.brokenAt == null && d.resistance.slope < 0;
  add(scored, 'Trendline', brokeTrendline || riding,
    brokeTrendline ? `Just closed through a ${tl.touches}-touch ${long ? 'falling' : 'rising'} trendline`
      : riding ? `Riding an intact ${long ? 'rising' : 'falling'} trendline` : 'No supporting trendline');

  add(scored, 'Volume expansion', d.volRatio >= 1.5, `Breakout-day volume ${d.volRatio.toFixed(1)}× the 20-day average`);
  add(scored, 'Coiled before the move', d.bbwRankBefore <= 35, `Bollinger width was in the ${Math.round(d.bbwRankBefore)}th percentile going in`);

  const rsiOk = long ? d.rsi >= 55 && d.rsi <= 80 : d.rsi <= 45 && d.rsi >= 20;
  add(scored, 'Momentum (RSI)', rsiOk, `Daily RSI ${d.rsi?.toFixed(0)}`);
  if (d.macd) add(scored, 'Momentum (MACD)', long ? d.macd.status === 'bullish' : d.macd.status === 'bearish', `MACD is ${d.macd.status}${d.macd.isHistogramRising ? ', histogram rising' : ''}`);
  add(scored, 'Trend strength (ADX)', d.adx != null && d.adxPrev != null && d.adx > d.adxPrev, `ADX ${d.adx?.toFixed(0)} ${d.adx > d.adxPrev ? 'rising' : 'not rising'}`);

  if (btcRead && sym !== 'BTC' && d.ret30 != null && btcRead.d1.ret30 != null) {
    const rs = d.ret30 - btcRead.d1.ret30;
    add(scored, 'Relative strength vs Bitcoin', long ? rs > 0 : rs < 0, `30-day return ${rs >= 0 ? '+' : ''}${rs.toFixed(1)}% vs BTC`);
  }

  const obstacle = long ? nearestAbove(d.levels, price) : nearestBelow(d.levels, price);
  const roomR = obstacle ? Math.abs(obstacle.price - price) / stopDist : null;
  add(scored, 'Room to run', roomR == null || roomR >= 1.5,
    obstacle ? `Next ${long ? 'resistance' : 'support'} zone ${fmt(obstacle.price)} is ${roomR.toFixed(1)}R away` : `No ${long ? 'resistance' : 'support'} zone ahead in the last 150 days`);

  if (d.shape) add(scored, 'Chart shape', long ? d.shape.bias !== 'bearish' : d.shape.bias !== 'bullish', d.shape.name);

  if (brief.breadth != null) add(scored, 'Breadth', long ? brief.breadth >= 0.6 : brief.breadth <= 0.4, `${Math.round(brief.breadth * 100)}% of coins above their 50-day average`);
  if (brief.news) add(scored, 'News tone', long ? brief.news.tone > -15 : brief.news.tone < 15, `24h headline tone ${brief.news.tone >= 0 ? '+' : ''}${brief.news.tone}`);

  const passed = scored.filter((c) => c.pass).length;
  const total = scored.length;
  const checklist = `${passed}/${total}`;

  const failed = must.filter((c) => !c.pass);
  const approved = failed.length === 0;

  const stop = price - dir * stopDist;
  const plan = {
    sym, dir, entry: price, stop, stopPct,
    exitRule: `Exit on a daily close ${long ? 'below' : 'above'} the ${EXIT_DAYS}-day ${long ? 'low' : 'high'}, or the stop`,
    exitLevel: long ? d.exitLow : d.exitHigh,
    feesR: roundTrip / stopPct,
  };

  return {
    sym, time: candidate.time, dir,
    decision: approved ? (long ? 'BUY' : 'SHORT') : 'REJECT',
    checklist, passed, total, must, scored, plan,
    summary: approved
      ? `${long ? 'Buy' : 'Short'} ${sym}: ${candidate.reason}. Stop ${fmt(stop)} (${stopPct.toFixed(1)}% away), trail with the ${EXIT_DAYS}-day ${long ? 'low' : 'high'}.`
      : `Rejected: ${failed.map((c) => c.name.toLowerCase()).join(', ')} failed.`,
  };
}

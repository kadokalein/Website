// Stock rules for the Trading Desk: the same three agents, adjusted to how stocks move.
//
// Stocks move about a quarter to a third as much as crypto, gap overnight, and react
// to earnings and (for pharma) FDA decisions. The rules below follow the evidence
// that holds up best for stocks — trend and 52-week-high breakouts in leaders, with
// market and sector filters — using the thresholds practitioners use (Minervini's
// trend template, O'Neil's buy zone and loss cap). Every threshold is in ATRs or
// relative terms, never crypto-sized percentages.

import { readChart } from '../chart/read.js';
import { nearestAbove } from '../chart/lines.js';
import { smaSeries, last } from '../chart/ta.js';
import { marketRegime, newsTone, HEADLINE_RISK_TONE } from './briefing.js';
import { zoneAt, describeLines, fmt } from './scout.js';

export const STOCK_PARAMS = {
  rangeDays: 50,          // trigger B: close above the prior 50-day high (a base of ~10 weeks)
  exitDays: 20,           // trailing exit: daily close below the 20-day low
  baseMaxDepthPct: 30,    // that base may not be deeper than 30%
  stopAtr: 2,             // initial stop 2 ATRs below entry…
  maxStopPct: 8,          // …or 8% below, whichever is closer
  skipIfAtrPct: 10,       // skip the trade if 2 ATRs is more than 10% of the price (too volatile)
  maxChasePct: 5,         // buy zone: at most 5% above the breakout line…
  maxChaseAtr: 1.0,       // …and at most 1 ATR above it
  max5dRunAtr: 3,         // don't buy after a 5-day run of more than 3 ATRs (short-term reversal risk)
  near52wHighPct: 15,     // trend template (tightened): within 15% of the 52-week high
  above52wLowPct: 30,     // and at least 30% above the 52-week low
  rsMinPct: 70,           // relative strength in the top 30% of the stocks the desk follows
  volConfirm: 1.25,       // breakout-day volume ≥ 1.25× average (supporting, not required)
  trailAtr: 3,            // chandelier trail: highest high since entry − 3 ATRs
  breakevenR: 1,          // stop moves to entry once the trade is up 1× its risk
  watchReachAtr: 1,       // "saved for later" when within 1 ATR of the line
};

const DAY = 86_400_000;
export const STOCK_WATCH_DAYS = 7;

const read = (m) => readChart(m.d1, null, { rangeDays: STOCK_PARAMS.rangeDays, exitDays: STOCK_PARAMS.exitDays });

// % change over n bars.
export function ret(candles, n) {
  if (!candles || candles.length <= n) return null;
  const a = candles[candles.length - 1 - n].close, b = candles[candles.length - 1].close;
  return (b / a - 1) * 100;
}

// IBD-style relative-strength score: recent quarter weighted double.
export function rsScore(candles) {
  const r = [63, 126, 189, 252].map((n) => ret(candles, n));
  if (r[0] == null) return null;
  const w = [0.4, 0.2, 0.2, 0.2];
  let s = 0, tw = 0;
  r.forEach((v, i) => { if (v != null) { s += v * w[i]; tw += w[i]; } });
  return tw ? s / tw : null;
}

function trendState(candles) {
  if (!candles || candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const close = last(closes);
  const s50 = last(smaSeries(closes, 50)), s200 = last(smaSeries(closes, 200));
  return { close, s50, s200, up: s50 != null && s200 != null && close > s50 && s50 > s200, above200: s200 != null && close > s200 };
}

function trendTemplate(d) {
  const P = STOCK_PARAMS;
  const c = d.bar.close;
  const checks = {
    above150and200: d.sma150 != null && d.sma200 != null && c > d.sma150 && c > d.sma200,
    ma150over200: d.sma150 != null && d.sma200 != null && d.sma150 > d.sma200,
    rising200: d.sma200 != null && d.sma200Prev != null && d.sma200 > d.sma200Prev,
    ma50overLong: d.sma50 != null && d.sma150 != null && d.sma50 > d.sma150 && d.sma50 > d.sma200,
    above50: d.sma50 != null && c > d.sma50,
    offLow: d.low52 > 0 && c >= d.low52 * (1 + P.above52wLowPct / 100),
    nearHigh: d.high52 > 0 && c >= d.high52 * (1 - P.near52wHighPct / 100),
  };
  return { ...checks, ok: Object.values(checks).every(Boolean) };
}

function templateMisses(tt) {
  return [
    !tt.above150and200 && 'below its 150/200-day averages',
    !tt.ma150over200 && '150-day average under the 200-day',
    !tt.rising200 && '200-day average not rising',
    !tt.ma50overLong && '50-day average not leading',
    !tt.above50 && 'below its 50-day average',
    !tt.nearHigh && `more than ${STOCK_PARAMS.near52wHighPct}% under its 52-week high`,
    !tt.offLow && 'too close to its 52-week low',
  ].filter(Boolean);
}

// ── Agent 1: Briefing for one stock sector ──────────────────────────────────
function brief({ group, reads, now, balance }) {
  const market = marketRegime(group.regimeD1);           // SPY vs its 200-day average
  const marketOk = market.phase === 'bull' && (market.anchorSlope == null || market.anchorSlope >= 0);
  const sector = group.sectorD1 ? marketRegime(group.sectorD1) : null;
  const sectorTrend = trendState(group.sectorD1);
  const rs3m = group.sectorD1 && group.regimeD1 ? (ret(group.sectorD1, 63) ?? 0) - (ret(group.regimeD1, 63) ?? 0) : null;
  const gauge = group.gauge ? trendState(group.gaugeD1) : null;
  const valid = Object.values(reads).filter(Boolean);
  const breadth = valid.length ? valid.filter((r) => r.d1.bar.close > r.d1.ema50).length / valid.length : null;
  const news = group.headlines ? newsTone(group.headlines, now) : null;
  const etf = group.benchmark ?? 'the sector ETF';

  const notes = [];
  const gates = [];
  if (market.phase === 'unknown') gates.push('not enough S&P 500 history');
  else if (marketOk) notes.push(`The S&P 500 (SPY) is ${Math.abs(market.distAnchorPct).toFixed(1)}% above a rising 200-day average: stock market uptrend.`);
  else {
    notes.push(`The S&P 500 (SPY) is ${market.phase === 'bull' ? 'above a flat or falling' : `${Math.abs(market.distAnchorPct).toFixed(1)}% below its`} 200-day average: no new stock buys.`);
    gates.push('S&P 500 not in an uptrend');
  }
  if (!sectorTrend) {
    notes.push(`${etf} data is not loaded yet.`);
    gates.push(`${etf} not loaded`);
  } else if (sectorTrend.up && (rs3m == null || rs3m > 0)) {
    notes.push(`${etf} is in an uptrend (above its 50-day, 50-day above 200-day) and beat the S&P 500 by ${rs3m?.toFixed(1)} points over 3 months — a leading sector.`);
  } else {
    if (!sectorTrend.up) gates.push(`${etf} not in an uptrend`);
    if (rs3m != null && rs3m <= 0) gates.push(`${etf} lagging the S&P 500`);
    notes.push(`${etf} ${sectorTrend.up ? 'is trending up' : 'is not in an uptrend'}${rs3m != null ? ` and ${rs3m >= 0 ? 'beat' : 'lagged'} the S&P 500 by ${Math.abs(rs3m).toFixed(1)} points over 3 months` : ''} — ${gates.length ? 'not a leading sector right now' : 'OK'}.`);
  }
  if (group.gauge === 'QQQ' && gauge) {
    if (!gauge.above200) gates.push('Nasdaq-100 (QQQ) below its 200-day average');
    notes.push(`The Nasdaq-100 (QQQ) is ${gauge.above200 ? 'above' : 'below'} its 200-day average.`);
  }
  if (group.gauge === 'USO' && gauge) notes.push(`Oil (USO fund) is ${gauge.close > gauge.s50 ? 'above' : 'below'} its 50-day average.`);
  if (breadth != null) notes.push(`${Math.round(breadth * 100)}% of the stocks tracked in this sector are above their 50-day average.`);
  if (news && news.count) notes.push(`${news.count} sector headlines in the last 24h: ${news.bullish} positive, ${news.bearish} negative.`);
  if (news && news.tone <= -HEADLINE_RISK_TONE) gates.push('heavily negative sector headlines');
  if (group.riskMult && group.riskMult < 1) notes.push('Positions here are half size: FDA decisions and trial results can move these stocks sharply overnight.');
  if (group.marketOpen === false) notes.push('The US stock market is closed now; new buys wait for the next regular session.');
  notes.push('Earnings dates are not available on the free data plan, so the desk cannot yet avoid buying right before an earnings report.');

  const allowLong = gates.length === 0;
  const parts = [
    { name: 'S&P 500 trend', value: marketOk ? 35 : market.phase === 'bear' ? -35 : -15 },
    ...(sectorTrend ? [{ name: `${etf} trend`, value: sectorTrend.up ? 25 : sector?.phase === 'bear' ? -25 : -10 }] : []),
    ...(rs3m != null ? [{ name: 'Sector vs market', value: Math.max(-15, Math.min(15, Math.round(rs3m))) }] : []),
    ...(breadth != null ? [{ name: 'Breadth', value: Math.round((breadth - 0.5) * 30) }] : []),
    ...(news ? [{ name: 'News tone', value: Math.round((news.tone / 100) * 15) }] : []),
  ];
  const score = Math.max(-100, Math.min(100, parts.reduce((s, p) => s + p.value, 0)));
  return {
    time: now, regime: market, sectorRegime: sector, breadth, fearGreed: null, news, balance,
    score, stance: score >= 25 ? 'Risk-on' : score <= -25 ? 'Risk-off' : 'Mixed', parts,
    allowLong, allowShort: false, shortsEnabled: false, notes, rs3m, gates,
    directive: allowLong
      ? `Scout: look for ${group.label} leaders breaking out to new highs.`
      : `Scout: no new buys in ${group.label} (${gates.join('; ')}) — keep the saved list current.`,
  };
}

// Which breakout line, if any, did the latest close clear?
function trigger(d) {
  const c = d.bar.close;
  if (d.high52Prev > 0 && c > d.high52Prev) return { kind: '52w', level: d.high52Prev, text: `Daily close at a new 52-week high (above ${fmt(d.high52Prev)})` };
  const depth = d.rangeHigh > 0 ? (1 - d.low50 / d.rangeHigh) * 100 : 100;
  if (c > d.rangeHigh && depth <= STOCK_PARAMS.baseMaxDepthPct) return { kind: 'base', level: d.rangeHigh, text: `Daily close above its ${d.rangeDays}-day base high at ${fmt(d.rangeHigh)} (base ${depth.toFixed(0)}% deep)` };
  return null;
}

// ── Agent 2: Scout ──────────────────────────────────────────────────────────
function scoutStock({ sym, read: r, brief: b, now, group }) {
  const base = { sym, time: now, price: r?.price ?? null, lines: r ? describeLines(r) : [], indicators: null };
  if (!r) return { ...base, verdict: 'PASS', reason: 'Not enough price history yet' };
  const d = r.d1;
  const close = d.bar.close;
  base.indicators = { rsi: d.rsi, macd: d.macd?.status ?? null, volRatio: d.volRatio, adx: d.adx, atrPct: d.atrPct, bbwRank: d.bbwRankBefore, trend: d.trend };
  const tt = trendTemplate(d);
  if (!tt.ok) return { ...base, verdict: 'PASS', reason: `Not a leader in an uptrend: ${templateMisses(tt).slice(0, 2).join(', ')}` };
  const rs = group.rsRank?.[sym];
  if (rs != null && rs < STOCK_PARAMS.rsMinPct) return { ...base, verdict: 'PASS', reason: `Relative strength only in the ${Math.round(rs)}th percentile (needs the top 30%)` };
  const t = trigger(d);
  if (t) {
    if (!b.allowLong) return { ...base, verdict: 'PASS', dir: 1, level: t.level, reason: `${t.text} — but the Briefing is not allowing buys in this sector right now` };
    return { ...base, verdict: 'OPEN', dir: 1, level: t.level, setup: t.kind === '52w' ? '52-week high' : 'base breakout', reason: t.text };
  }
  const line = Math.min(d.high52Prev || Infinity, d.rangeHigh);
  if (b.allowLong && line - close <= STOCK_PARAMS.watchReachAtr * d.atr) {
    return {
      ...base, verdict: 'WATCH', dir: 1, level: line, setup: 'breakout',
      reason: `${((line / close - 1) * 100).toFixed(1)}% below its breakout line — a leader in an uptrend`,
      trigger: `a daily close above ${fmt(line)}`, expires: now + STOCK_WATCH_DAYS * DAY,
    };
  }
  return { ...base, verdict: 'PASS', reason: 'A leader in an uptrend, but not near a breakout line' };
}

// ── Agent 3: Analyst ────────────────────────────────────────────────────────
function analyzeStock({ sym, read: r, brief: b, candidate, livePrice, group }) {
  const P = STOCK_PARAMS;
  const d = r.d1;
  const close = d.bar.close;
  const price = livePrice ?? close;
  const level = candidate.level;
  const must = [], scored = [];
  const add = (list, name, pass, detail) => list.push({ name, pass: !!pass, detail });
  const tt = trendTemplate(d);
  const rs = group.rsRank?.[sym] ?? null;

  add(must, 'Market & sector', b.allowLong, b.allowLong ? `S&P 500 uptrend; ${group.benchmark} leading` : (b.gates ?? []).join('; '));
  add(must, 'Closed through the line', close > level, `${candidate.reason}`);
  add(must, 'Leader in an uptrend', tt.ok, tt.ok ? `All trend-template checks pass; ${((1 - close / d.high52) * 100).toFixed(1)}% below the 52-week high` : templateMisses(tt).join(', '));
  if (rs != null) add(must, 'Relative strength', rs >= P.rsMinPct, `${Math.round(rs)}th percentile of the stocks the desk follows (needs ${P.rsMinPct}+)`);
  const pastLine = (price / level - 1) * 100;
  const pastAtr = (price - level) / d.atr;
  add(must, 'In the buy zone', pastLine >= 0 && pastLine <= P.maxChasePct && pastAtr <= P.maxChaseAtr,
    `Price ${fmt(price)} is ${pastLine.toFixed(1)}% (${pastAtr.toFixed(2)} ATR) above the line — limit ${P.maxChasePct}% and ${P.maxChaseAtr} ATR`);
  const run5 = d.window.length > 6 ? (close - d.window[d.window.length - 6].close) / d.atr : 0;
  add(must, 'Not overextended', run5 <= P.max5dRunAtr, `5-day move ${run5.toFixed(1)} ATR (limit ${P.max5dRunAtr})`);
  const atrStopPct = (P.stopAtr * d.atr / price) * 100;
  add(must, 'Volatility is manageable', atrStopPct <= P.skipIfAtrPct, `${P.stopAtr} ATR = ${atrStopPct.toFixed(1)}% of the price (skip above ${P.skipIfAtrPct}%)`);
  const stopDist = Math.min(P.stopAtr * d.atr, price * P.maxStopPct / 100);
  const stopPct = (stopDist / price) * 100;

  // Supporting chart work
  add(scored, 'Volume confirms', d.volRatio >= P.volConfirm, `Breakout-day volume ${d.volRatio.toFixed(1)}× the 20-day average`);
  const zone = zoneAt(r, level);
  add(scored, 'Line quality', zone && zone.touches >= 2, zone ? `${zone.touches} swing touches near ${fmt(zone.price)}` : 'A fresh high — no prior swing points at this level');
  add(scored, 'Tight base before the move', d.bbwRankBefore <= 35, `Bollinger width in the ${Math.round(d.bbwRankBefore)}th percentile going in`);
  if (b.rs3m != null) add(scored, 'Sector beats the market', b.rs3m > 0, `${group.benchmark} ${b.rs3m >= 0 ? '+' : ''}${b.rs3m.toFixed(1)} points vs SPY over 3 months`);
  add(scored, 'Momentum (RSI)', d.rsi >= 55 && d.rsi <= 80, `Daily RSI ${d.rsi?.toFixed(0)}`);
  add(scored, 'Swing structure', d.structure.trend === 'up', d.structure.trend === 'up' ? 'Higher highs and higher lows' : 'No clean higher-high sequence');
  const obstacle = nearestAbove(d.levels, price);
  const roomR = obstacle ? (obstacle.price - price) / stopDist : null;
  add(scored, 'Room to run', roomR == null || roomR >= 1.5, obstacle ? `Next resistance ${fmt(obstacle.price)} is ${roomR.toFixed(1)}R away` : 'Clear air above');
  if (group.gauge === 'USO' && group.gaugeD1) { const g = trendState(group.gaugeD1); if (g) add(scored, 'Oil price trend', g.close > g.s50, `USO ${g.close > g.s50 ? 'above' : 'below'} its 50-day average`); }
  if (b.news && b.news.count) add(scored, 'Sector news tone', b.news.tone > -15, `24h headline tone ${b.news.tone >= 0 ? '+' : ''}${b.news.tone}`);

  const passed = scored.filter((c) => c.pass).length;
  const total = scored.length;
  const failed = must.filter((c) => !c.pass);
  const approved = failed.length === 0;
  const stop = price - stopDist;
  // Rank across sectors: relative strength first, then sector strength, nearness to the high, volume.
  const rank = 0.5 * ((rs ?? 50) / 100) + 0.2 * ((group.sectorRank ?? 50) / 100) + 0.15 * Math.min(1, close / d.high52) + 0.15 * Math.min(d.volRatio / 2, 1);
  return {
    sym, time: candidate.time, dir: 1,
    decision: approved ? 'BUY' : 'REJECT',
    checklist: `${passed}/${total}`, passed, total, must, scored, rank,
    setupLabel: candidate.setup === '52-week high' ? '52-week-high breakout' : 'Base breakout',
    plan: {
      sym, dir: 1, entry: price, stop, stopPct,
      exitRule: `Exit on a daily close below the ${d.exitDays}-day low; the stop moves to entry once up 1R and trails 3 ATR below the highest high`,
      exitLevel: d.exitLow, feesR: 0, trailAtr: P.trailAtr, breakevenR: P.breakevenR,
    },
    summary: approved
      ? `Buy ${sym}: ${candidate.reason}. Stop ${fmt(stop)} (${stopPct.toFixed(1)}% away)${group.riskMult < 1 ? ', half size' : ''}.`
      : `Rejected: ${failed.map((c) => c.name.toLowerCase()).join(', ')} failed.`,
  };
}

export const STOCK_RULES = { read, brief, scout: scoutStock, analyze: analyzeStock };

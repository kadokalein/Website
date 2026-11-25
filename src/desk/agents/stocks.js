// Stock rules for the Trading Desk: the same three agents, adjusted to how stocks move.
//
// Stocks trend more slowly and smoothly than crypto, gap overnight, and react to
// earnings and (for pharma) FDA news. So the stock desk:
//   • gates on the S&P 500 (SPY) AND the sector's own ETF, not on Bitcoin
//   • only buys leaders in an established uptrend (the "trend template":
//     above the 150- and 200-day averages, 200-day rising, near the 52-week high)
//   • buys the close through a multi-week base high on above-average volume,
//     but never chases more than a few % past it
//   • places the stop by volatility and caps the loss per share
//   • has no commission to pay on Coinbase, so smaller moves are worth taking

import { readChart } from '../chart/read.js';
import { nearestAbove } from '../chart/lines.js';
import { marketRegime, newsTone, HEADLINE_RISK_TONE } from './briefing.js';
import { zoneAt, describeLines, fmt } from './scout.js';

export const STOCK_PARAMS = {
  rangeDays: 20,          // the base whose high is the breakout line (≈ 4 trading weeks)
  exitDays: 20,           // trailing exit: daily close below the 20-day low
  stopAtr: 2.5,           // initial stop distance in daily ATRs…
  maxStopPct: 10,         // …but never more than this far below entry (O'Neil-style loss cap)
  minStopPct: 2,          // tighter than this is noise for a daily-bar system
  maxChasePct: 5,         // buy zone: at most 5% above the breakout line
  maxChaseAtr: 1.0,       // and at most 1 ATR above the signal close
  within52wHighPct: 25,   // trend template: within 25% of the 52-week high
  above52wLowPct: 30,     // and at least 30% above the 52-week low
  volConfirm: 1.4,        // breakout-day volume ≥ 1.4× the 20-day average (supporting)
  earningsBlackoutDays: 5,// no new entry within this many days before earnings (when known)
  watchReachPct: 3,       // "saved for later" when within 3% (or 1 ATR) of the line
};

const DAY = 86_400_000;
export const STOCK_WATCH_DAYS = 7;

const read = (m) => readChart(m.d1, null, { rangeDays: STOCK_PARAMS.rangeDays, exitDays: STOCK_PARAMS.exitDays });

// Percent change over n bars of a candle array.
function ret(candles, n) {
  if (!candles || candles.length <= n) return null;
  const a = candles[candles.length - 1 - n].close, b = candles[candles.length - 1].close;
  return (b / a - 1) * 100;
}

function trendTemplate(d) {
  const checks = {
    above150: d.sma150 != null && d.bar.close > d.sma150,
    above200: d.sma200 != null && d.bar.close > d.sma200,
    rising200: d.sma200 != null && d.sma200Prev != null && d.sma200 > d.sma200Prev,
    nearHigh: d.high52 > 0 && d.bar.close >= d.high52 * (1 - STOCK_PARAMS.within52wHighPct / 100),
    offLow: d.low52 > 0 && d.bar.close >= d.low52 * (1 + STOCK_PARAMS.above52wLowPct / 100),
  };
  return { ...checks, ok: Object.values(checks).every(Boolean) };
}

// ── Agent 1: Briefing for one stock sector ──────────────────────────────────
function brief({ group, reads, now, balance }) {
  const market = marketRegime(group.regimeD1);           // SPY vs its 200-day average
  const sector = group.sectorD1 ? marketRegime(group.sectorD1) : null; // sector ETF vs its 200-day
  const valid = Object.values(reads).filter(Boolean);
  const breadth = valid.length ? valid.filter((r) => r.d1.bar.close > r.d1.ema50).length / valid.length : null;
  const news = group.headlines ? newsTone(group.headlines, now) : null;
  const rs3m = group.sectorD1 && group.regimeD1 ? (ret(group.sectorD1, 63) ?? 0) - (ret(group.regimeD1, 63) ?? 0) : null;

  const notes = [];
  let allowLong = market.phase === 'bull' && (!sector || sector.phase !== 'bear');
  const etf = group.benchmark ?? 'the sector ETF';
  if (market.phase === 'unknown') notes.push('Not enough S&P 500 history to judge the market — standing aside.');
  else if (market.phase === 'bull') notes.push(`The S&P 500 (SPY) is ${Math.abs(market.distAnchorPct).toFixed(1)}% above its 200-day average: stock market uptrend.`);
  else notes.push(`The S&P 500 (SPY) is ${Math.abs(market.distAnchorPct).toFixed(1)}% below its 200-day average${market.phase === 'correction' ? ', which is still rising — a correction' : ', which is falling — a downtrend'}: no new stock buys.`);
  if (sector) {
    if (sector.phase === 'bull') notes.push(`${etf} is above its 200-day average: the sector is in an uptrend.`);
    else if (sector.phase === 'correction') notes.push(`${etf} is below its still-rising 200-day average: the sector is pulling back — only the strongest charts qualify.`);
    else notes.push(`${etf} is below its falling 200-day average: the sector is in a downtrend — no new buys here.`);
  } else if (group.sectorD1 === null && group.benchmark) {
    notes.push(`${etf} data is not loaded yet, so only the S&P 500 gate applies.`);
  }
  if (rs3m != null) notes.push(`Over 3 months the sector ${rs3m >= 0 ? 'beat' : 'lagged'} the S&P 500 by ${Math.abs(rs3m).toFixed(1)} points.`);
  if (breadth != null) notes.push(`${Math.round(breadth * 100)}% of the stocks tracked in this sector are above their 50-day average.`);
  if (news && news.count) notes.push(`${news.count} sector headlines in the last 24h: ${news.bullish} positive, ${news.bearish} negative.`);
  if (news && news.tone <= -HEADLINE_RISK_TONE && allowLong) { allowLong = false; notes.push('Sector headlines are heavily negative — holding off on new buys until the tone settles.'); }
  if (group.marketOpen === false) notes.push('The US stock market is closed right now; signals are prepared for the next session.');

  const parts = [
    { name: 'S&P 500 trend', value: market.phase === 'bull' ? 35 : market.phase === 'bear' ? -35 : -15 },
    ...(sector ? [{ name: `${etf} trend`, value: sector.phase === 'bull' ? 25 : sector.phase === 'bear' ? -25 : -10 }] : []),
    ...(rs3m != null ? [{ name: 'Sector vs market', value: Math.max(-15, Math.min(15, Math.round(rs3m))) }] : []),
    ...(breadth != null ? [{ name: 'Breadth', value: Math.round((breadth - 0.5) * 30) }] : []),
    ...(news ? [{ name: 'News tone', value: Math.round((news.tone / 100) * 15) }] : []),
  ];
  const score = Math.max(-100, Math.min(100, parts.reduce((s, p) => s + p.value, 0)));
  return {
    time: now, regime: market, sectorRegime: sector, breadth, fearGreed: null, news, balance,
    score, stance: score >= 25 ? 'Risk-on' : score <= -25 ? 'Risk-off' : 'Mixed', parts,
    allowLong, allowShort: false, shortsEnabled: false, notes, rs3m,
    directive: allowLong ? `Scout: look for ${group.label.toLowerCase()} breakouts from leaders in an uptrend.` : 'Scout: no new buys in this sector — keep the saved list current.',
  };
}

// ── Agent 2: Scout ──────────────────────────────────────────────────────────
function scoutStock({ sym, read: r, brief: b, now }) {
  const base = { sym, time: now, price: r?.price ?? null, lines: r ? describeLines(r) : [], indicators: null };
  if (!r) return { ...base, verdict: 'PASS', reason: 'Not enough price history yet' };
  const d = r.d1;
  const close = d.bar.close;
  base.indicators = { rsi: d.rsi, macd: d.macd?.status ?? null, volRatio: d.volRatio, adx: d.adx, atrPct: d.atrPct, bbwRank: d.bbwRankBefore, trend: d.trend };
  const tt = trendTemplate(d);
  const line = d.rangeHigh;
  const brokeUp = close > line;
  if (!tt.ok) {
    const miss = [!tt.above200 && 'below its 200-day average', !tt.above150 && 'below its 150-day average', !tt.rising200 && '200-day average not rising', !tt.nearHigh && `more than ${STOCK_PARAMS.within52wHighPct}% under its 52-week high`, !tt.offLow && 'too close to its 52-week low'].filter(Boolean);
    return { ...base, verdict: 'PASS', reason: `Not in a leader's uptrend: ${miss.slice(0, 2).join(', ')}` };
  }
  if (brokeUp) {
    const what = `Daily close above its ${d.rangeDays}-day base high at ${fmt(line)}`;
    if (!b.allowLong) return { ...base, verdict: 'PASS', dir: 1, level: line, reason: `${what} — but the Briefing is not allowing buys in this sector right now` };
    return { ...base, verdict: 'OPEN', dir: 1, level: line, setup: 'breakout', reason: what };
  }
  const reach = Math.max(d.atr, close * STOCK_PARAMS.watchReachPct / 100);
  if (b.allowLong && line - close <= reach) {
    return {
      ...base, verdict: 'WATCH', dir: 1, level: line, setup: 'breakout',
      reason: `${((line / close - 1) * 100).toFixed(1)}% below its ${d.rangeDays}-day base high, in an uptrend`,
      trigger: `a daily close above ${fmt(line)}`, expires: now + STOCK_WATCH_DAYS * DAY,
    };
  }
  return { ...base, verdict: 'PASS', reason: 'In an uptrend but mid-range — no line in play' };
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

  add(must, 'Market & sector regime', b.allowLong, `S&P 500 ${b.regime.phase}${b.sectorRegime ? `, ${group.benchmark} ${b.sectorRegime.phase}` : ''}`);
  add(must, 'Closed through the line', close > level, `Daily close ${fmt(close)} vs ${d.rangeDays}-day base high ${fmt(level)}`);
  add(must, 'Leader in an uptrend', tt.ok, `Above 150/200-day averages, 200-day rising, ${((1 - close / d.high52) * 100).toFixed(1)}% below the 52-week high`);
  const pastLine = (price / level - 1) * 100;
  const chaseAtr = (price - close) / d.atr;
  add(must, 'In the buy zone', pastLine >= 0 && pastLine <= P.maxChasePct && chaseAtr <= P.maxChaseAtr,
    `Price ${fmt(price)} is ${pastLine.toFixed(1)}% above the line (max ${P.maxChasePct}%) and ${chaseAtr.toFixed(2)} ATR past the signal close`);
  let stopDist = Math.min(P.stopAtr * d.atr, price * P.maxStopPct / 100);
  stopDist = Math.max(stopDist, price * P.minStopPct / 100);
  const stopPct = (stopDist / price) * 100;
  add(must, 'Risk is contained', P.stopAtr * d.atr <= price * P.maxStopPct / 100 * 1.6,
    `Stop ${stopPct.toFixed(1)}% below entry (${P.stopAtr} ATR is ${(P.stopAtr * d.atr / price * 100).toFixed(1)}%; cap ${P.maxStopPct}%)`);
  const nextEarnings = group.earnings?.[sym] ?? null;
  if (nextEarnings != null) {
    const days = (nextEarnings - Date.now()) / DAY;
    add(must, 'No earnings in the next week', !(days >= 0 && days <= P.earningsBlackoutDays + 2), `Next earnings ${new Date(nextEarnings).toISOString().slice(0, 10)}`);
  }

  // Supporting chart work
  add(scored, 'Volume confirms', d.volRatio >= P.volConfirm, `Breakout-day volume ${d.volRatio.toFixed(1)}× the 20-day average (want ≥ ${P.volConfirm}×)`);
  const zone = zoneAt(r, level);
  add(scored, 'Line quality', zone && zone.touches >= 3, zone ? `${zone.touches} swing touches at ${fmt(zone.price)}` : 'No clustered swing points at the line');
  add(scored, 'Tight base before the move', d.bbwRankBefore <= 35, `Bollinger width in the ${Math.round(d.bbwRankBefore)}th percentile going in`);
  add(scored, 'Near the 52-week high', close >= d.high52 * 0.95, `${((1 - close / d.high52) * 100).toFixed(1)}% below the 52-week high`);
  const rsStock = (ret(d.window, 63) ?? 0) - (ret(group.regimeD1, 63) ?? 0);
  add(scored, 'Beats the S&P 500', rsStock > 0, `3-month return ${rsStock >= 0 ? '+' : ''}${rsStock.toFixed(1)} points vs SPY`);
  if (b.rs3m != null) add(scored, 'Sector beats the market', b.rs3m > 0, `${group.benchmark} ${b.rs3m >= 0 ? '+' : ''}${b.rs3m.toFixed(1)} points vs SPY over 3 months`);
  add(scored, 'Momentum (RSI)', d.rsi >= 55 && d.rsi <= 80, `Daily RSI ${d.rsi?.toFixed(0)}`);
  add(scored, 'Swing structure', d.structure.trend === 'up', d.structure.trend === 'up' ? 'Higher highs and higher lows' : 'No clean higher-high sequence');
  const obstacle = nearestAbove(d.levels, price);
  const roomR = obstacle ? (obstacle.price - price) / stopDist : null;
  add(scored, 'Room to run', roomR == null || roomR >= 1.5, obstacle ? `Next resistance ${fmt(obstacle.price)} is ${roomR.toFixed(1)}R away` : 'Clear air above (no resistance in the last 150 days)');
  if (b.news && b.news.count) add(scored, 'Sector news tone', b.news.tone > -15, `24h headline tone ${b.news.tone >= 0 ? '+' : ''}${b.news.tone}`);

  const passed = scored.filter((c) => c.pass).length;
  const total = scored.length;
  const failed = must.filter((c) => !c.pass);
  const approved = failed.length === 0;
  const stop = price - stopDist;
  return {
    sym, time: candidate.time, dir: 1,
    decision: approved ? 'BUY' : 'REJECT',
    checklist: `${passed}/${total}`, passed, total, must, scored,
    rank: passed / Math.max(1, total) + Math.max(-0.2, Math.min(0.2, rsStock / 100)),
    setupLabel: 'Base breakout',
    plan: {
      sym, dir: 1, entry: price, stop, stopPct,
      exitRule: `Exit on a daily close below the ${d.exitDays}-day low, or the stop`,
      exitLevel: d.exitLow, feesR: 0,
    },
    summary: approved
      ? `Buy ${sym}: ${candidate.reason}. Stop ${fmt(stop)} (${stopPct.toFixed(1)}% away), trail with the ${d.exitDays}-day low.`
      : `Rejected: ${failed.map((c) => c.name.toLowerCase()).join(', ')} failed.`,
  };
}

export const STOCK_RULES = { read, brief, scout: scoutStock, analyze: analyzeStock };

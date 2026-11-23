// Agent 1 — Briefing. Reads the market's mood before anyone looks for a trade:
// the Bitcoin regime (the tide every coin swims in), breadth, the Fear & Greed
// index, and news headlines. Its output tells the Scout which direction, if any,
// is worth hunting in.

import { emaSeries, smaSeries, last } from '../chart/ta.js';

// Bitcoin vs its 200-day average is the regime switch: in the history tested,
// breakout longs only paid while BTC was above it.
export function marketRegime(btcD1) {
  if (!btcD1 || btcD1.length < 60) return { phase: 'unknown', momentum: 'mixed' };
  const closes = btcD1.map((c) => c.close);
  const close = last(closes);
  const smaS = smaSeries(closes, 200);
  const sma200 = last(smaS);
  const ema50 = last(emaSeries(closes, 50));
  const ema20 = last(emaSeries(closes, 20));
  const anchor = sma200 ?? ema50;
  const smaPrev = smaS[smaS.length - 21];
  const anchorSlope = sma200 != null && smaPrev != null ? ((sma200 - smaPrev) / smaPrev) * 100 : null; // % over 20 days
  const rising = anchorSlope == null || anchorSlope > 0;
  // bull: above the average.  bear: below a FALLING average.
  // correction: below an average that is still rising — the trend is damaged, not reversed; stand aside.
  const phase = close > anchor ? 'bull' : rising ? 'correction' : 'bear';
  let momentum = 'mixed';
  if (close > ema50 && ema20 > ema50) momentum = 'up';
  else if (close < ema50 && ema20 < ema50) momentum = 'down';
  const n = closes.length;
  const ret = (b) => (n > b ? (close / closes[n - 1 - b] - 1) * 100 : null);
  return {
    phase, momentum, close, sma200, ema50, ema20, anchorSlope,
    anchorLabel: sma200 ? '200-day average' : '50-day average',
    distAnchorPct: ((close - anchor) / anchor) * 100,
    ret7: ret(7), ret30: ret(30),
  };
}

// ── Headline tone ────────────────────────────────────────────────────────────
// A deliberately simple, transparent lexicon. It cannot "understand" news; it
// flags obviously market-moving words so a human can see why the tone reads as it does.
const BULLISH = [
  ['surge', 2], ['soar', 2], ['rally', 2], ['rallies', 2], ['record high', 3], ['all-time high', 3], ['breakout', 1],
  ['bullish', 2], ['gains', 1], ['jumps', 2], ['climbs', 1], ['rebound', 2], ['recover', 1], ['approval', 2], ['approves', 2],
  ['approved', 2], ['inflows', 2], ['adoption', 1], ['rate cut', 2], ['cuts rates', 2], ['buys', 1], ['accumulat', 1],
  ['upgrade', 1], ['partnership', 1], ['etf launch', 2], ['strategic reserve', 2], ['eases', 1],
];
const BEARISH = [
  ['crash', 3], ['plunge', 3], ['plummet', 3], ['tumble', 2], ['slump', 2], ['sell-off', 2], ['selloff', 2], ['dump', 2],
  ['bearish', 2], ['falls', 1], ['drops', 1], ['slides', 1], ['sinks', 2], ['liquidat', 2], ['hack', 3], ['exploit', 3],
  ['stolen', 3], ['lawsuit', 2], ['sues', 2], ['charged', 2], ['fraud', 3], ['ban', 2], ['crackdown', 2], ['outflows', 2],
  ['bankrupt', 3], ['insolven', 3], ['collapse', 3], ['rate hike', 2], ['recession', 2], ['tariff', 1], ['war', 1],
  ['delist', 2], ['investigation', 1], ['fear', 1], ['capitulat', 2], ['halts withdrawals', 3], ['depeg', 3],
];

export function scoreHeadline(title) {
  const t = ` ${String(title ?? '').toLowerCase()} `;
  let score = 0;
  const hits = [];
  for (const [w, v] of BULLISH) if (t.includes(w)) { score += v; hits.push(`+${w}`); }
  for (const [w, v] of BEARISH) if (t.includes(w)) { score -= v; hits.push(`-${w}`); }
  return { score: Math.max(-4, Math.min(4, score)), hits };
}

// headlines: [{ title, source, url, time }]. Returns tone in -100..100 from the last 24h.
export function newsTone(headlines, now) {
  const recent = (headlines ?? []).filter((h) => !h.time || now - h.time <= 24 * 3_600_000);
  const scored = recent.map((h) => ({ ...h, ...scoreHeadline(h.title) }));
  const flagged = scored.filter((h) => h.score !== 0);
  const tone = scored.length ? Math.round((scored.reduce((s, h) => s + h.score, 0) / (scored.length * 2)) * 100) : 0;
  return {
    tone: Math.max(-100, Math.min(100, tone)),
    count: scored.length,
    bullish: flagged.filter((h) => h.score > 0).length,
    bearish: flagged.filter((h) => h.score < 0).length,
    headlines: scored,
  };
}

export const HEADLINE_RISK_TONE = 35;

// Compose the hand-off to the Scout.
//   regime     — marketRegime(btc daily)
//   breadth    — fraction (0..1) of the universe trading above its own 50-day EMA, or null
//   fearGreed  — { value: 0..100, label } or null
//   news       — newsTone(...) or null
//   balance    — { paper: { equity, cash }, coinbase: fetchCoinbaseBalance() result or null }
//   shortsEnabled — whether the paper account may short at all (off by default)
export function buildBriefing({ regime, breadth = null, fearGreed = null, news = null, balance = null, shortsEnabled = false, now }) {
  const notes = [];
  let allowLong = regime.phase === 'bull';
  let allowShort = regime.phase === 'bear' && shortsEnabled;

  if (regime.phase === 'unknown') {
    notes.push('Not enough Bitcoin history to judge the market regime — standing aside.');
  } else {
    const where = `Bitcoin is ${Math.abs(regime.distAnchorPct).toFixed(1)}% ${regime.phase === 'bull' ? 'above' : 'below'} its ${regime.anchorLabel}`;
    if (regime.phase === 'bull') notes.push(`${where}: uptrend regime — breakout longs are allowed.`);
    else if (regime.phase === 'correction') notes.push(`${where}, which is still rising: the uptrend is damaged but not reversed — standing aside.`);
    else notes.push(`${where}, which is falling: downtrend regime — buying is blocked.`);
  }
  if (regime.phase === 'bull' && regime.momentum === 'down') notes.push('Short-term Bitcoin momentum is down inside the larger uptrend — expect pullbacks.');
  if (regime.phase === 'bear' && regime.momentum === 'up') notes.push('Bitcoin is bouncing inside a larger downtrend — relief rallies can be sharp.');

  const tone = news?.tone ?? 0;
  if (news && tone <= -HEADLINE_RISK_TONE && allowLong) { allowLong = false; notes.push('Headlines are heavily negative — holding off on new longs until the tone settles.'); }
  if (news && tone >= HEADLINE_RISK_TONE && allowShort) { allowShort = false; notes.push('Headlines are heavily positive — holding off on new shorts until the tone settles.'); }

  // Composite mood, -100..100, for display.
  const parts = [];
  if (regime.phase !== 'unknown') parts.push({ name: 'Bitcoin regime', value: regime.phase === 'bull' ? 40 : -40 });
  parts.push({ name: 'Bitcoin momentum', value: regime.momentum === 'up' ? 20 : regime.momentum === 'down' ? -20 : 0 });
  if (breadth != null) parts.push({ name: 'Breadth', value: Math.round((breadth - 0.5) * 30) });
  if (fearGreed) parts.push({ name: 'Fear & Greed', value: Math.round(((fearGreed.value - 50) / 50) * 10) });
  if (news) parts.push({ name: 'News tone', value: Math.round((tone / 100) * 15) });
  const score = Math.max(-100, Math.min(100, parts.reduce((s, p) => s + p.value, 0)));
  const stance = score >= 25 ? 'Risk-on' : score <= -25 ? 'Risk-off' : 'Mixed';

  if (breadth != null) notes.push(`${Math.round(breadth * 100)}% of tracked coins are above their 50-day average.`);
  if (fearGreed) notes.push(`Fear & Greed index: ${fearGreed.value} (${fearGreed.label}).`);
  if (news) notes.push(`${news.count} headlines in the last 24h: ${news.bullish} positive, ${news.bearish} negative.`);

  const hunting = allowLong ? 'look for long breakouts'
    : allowShort ? 'look for short breakdowns'
    : 'no new trades — keep the saved list current and stay in cash';
  return {
    time: now, regime, breadth, fearGreed, news, balance,
    score, stance, parts, allowLong, allowShort, shortsEnabled, notes,
    directive: `Scout: ${hunting}.`,
  };
}

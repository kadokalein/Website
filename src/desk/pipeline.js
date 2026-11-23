// The Trading Desk pipeline: Briefing → Scout → Analyst → paper execution.
// One pure function so the browser and the backtest run exactly the same logic.

import { readChart } from './chart/read.js';
import { marketRegime, buildBriefing, newsTone } from './agents/briefing.js';
import { scout } from './agents/scout.js';
import { analyze, ANALYST_DEFAULTS } from './agents/analyst.js';
import {
  DEFAULT_FEES, DEFAULT_RISK, equity, entryBlock, sizeForRisk, openPosition, closePosition, markDay,
} from './engine/account.js';

export const DESK_CONFIG = {
  fees: DEFAULT_FEES,
  risk: DEFAULT_RISK,
  analyst: ANALYST_DEFAULTS,
  allowShorts: false,         // shorts lost money in backtests and Coinbase spot cannot short; paper-only opt-in
  execute: true,              // false = advisory: analyse and manage exits, but open nothing
};

// market:     { SYM: { d1: closedDailyCandles, h4?: closed4hCandles } }  — must include BTC
// livePrices: { SYM: price } — where fills happen; defaults to the last daily close
// external:   { fearGreed, headlines, coinbase }
// watch:      { SYM: scoutResult } carried between cycles
export function runCycle({ now, market, account, watch = {}, external = {}, livePrices = {}, config = DESK_CONFIG }) {
  const reads = {};
  for (const [sym, m] of Object.entries(market)) reads[sym] = readChart(m.d1, m.h4 ?? null);
  const priceOf = (sym) => livePrices[sym] ?? reads[sym]?.price;

  // ── Agent 1: Briefing ─────────────────────────────────────────────────────
  const valid = Object.values(reads).filter(Boolean);
  const breadth = valid.length ? valid.filter((r) => r.d1.bar.close > r.d1.ema50).length / valid.length : null;
  const prices = {};
  for (const sym of Object.keys(market)) { const p = priceOf(sym); if (p != null) prices[sym] = p; }
  const eq = equity(account, prices);
  const brief = buildBriefing({
    regime: marketRegime(market.BTC?.d1),
    breadth,
    fearGreed: external.fearGreed ?? null,
    news: external.headlines ? newsTone(external.headlines, now) : null,
    balance: { paper: { equity: eq, cash: account.cash }, coinbase: external.coinbase ?? null },
    shortsEnabled: !!config.allowShorts,
    now,
  });

  // ── Manage open positions: trailing channel exit on the latest closed day ─
  const closed = [];
  for (const pos of Object.values(account.positions)) {
    const r = reads[pos.sym];
    if (!r || pos.managedBar === r.d1.bar.time || r.d1.bar.time < pos.signalBar) continue;
    pos.managedBar = r.d1.bar.time;
    pos.meta.exitLevel = pos.dir > 0 ? r.d1.exitLow : r.d1.exitHigh;
    const c = r.d1.bar.close;
    const exit = pos.dir > 0 ? c < r.d1.exitLowPrev : c > r.d1.exitHighPrev;
    if (exit && r.d1.bar.time > pos.signalBar) {
      closed.push(closePosition(account, pos.sym, priceOf(pos.sym), 'Trailing channel exit', now, config.fees.taker));
    }
  }

  // ── Agent 2: Scout ────────────────────────────────────────────────────────
  const scouts = [];
  for (const sym of Object.keys(market)) {
    const s = scout({ sym, read: reads[sym], brief, now });
    s.held = !!account.positions[sym];
    scouts.push(s);
  }

  // Saved-for-later list: add new WATCH items, keep the original expiry, drop stale ones.
  const nextWatch = {};
  for (const s of scouts) {
    if (s.verdict !== 'WATCH' || s.held) continue;
    const prev = watch[s.sym];
    const same = prev && prev.dir === s.dir;
    nextWatch[s.sym] = { ...s, since: same ? prev.since : now, expires: same ? prev.expires : s.expires };
    if (nextWatch[s.sym].expires <= now) delete nextWatch[s.sym];
  }

  // ── Agent 3: Analyst ──────────────────────────────────────────────────────
  account.signals ??= {};
  const analyses = [];
  for (const s of scouts) {
    if (s.verdict !== 'OPEN' || s.held) continue;
    const a = analyze({
      sym: s.sym, read: reads[s.sym], brief, candidate: s, btcRead: reads.BTC,
      fees: config.fees, livePrice: priceOf(s.sym), config: config.analyst,
    });
    a.fromWatch = !!watch[s.sym];
    analyses.push(a);
  }
  analyses.sort((x, y) => y.passed / y.total - x.passed / x.total);

  // ── Execution (paper) ─────────────────────────────────────────────────────
  const opened = [];
  for (const a of analyses) {
    if (a.decision === 'REJECT') continue;
    const bar = reads[a.sym].d1.bar.time;
    if (account.signals[a.sym] === bar) { a.note = 'Already acted on this signal'; continue; }
    if (!config.execute) { a.note = 'Approved — auto-trading is paused, so nothing was opened'; continue; }
    const block = entryBlock(account, now, prices, config.risk);
    if (block) { a.note = `Approved but not taken: ${block}`; continue; }
    const sizeUsd = sizeForRisk(equity(account, prices), account.cash, a.plan.entry, a.plan.stop, config.risk, config.fees);
    const pos = openPosition(account, {
      sym: a.sym, dir: a.dir, entry: a.plan.entry, stop: a.plan.stop, sizeUsd,
      meta: { setup: a.dir > 0 ? 'Breakout' : 'Breakdown', checklist: a.checklist, summary: a.summary, exitLevel: a.plan.exitLevel },
    }, now, config.fees);
    if (!pos) { a.note = 'Approved but position too small to open'; continue; }
    pos.signalBar = bar;
    account.signals[a.sym] = bar;
    a.note = `Opened ${a.dir > 0 ? 'long' : 'short'} — $${sizeUsd.toFixed(0)}`;
    a.sizeUsd = sizeUsd;
    opened.push(pos);
  }

  markDay(account, now, prices);
  return { brief, reads, scouts, analyses, opened, closed, watch: nextWatch };
}

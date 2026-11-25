// The Trading Desk pipeline: Briefing → Scout → Analyst → paper execution.
// Pure functions so the browser and the backtest run exactly the same logic.
//
// The desk covers several sectors (crypto, and stock sectors such as pharma or AI).
// Each sector is a "group": it gets its own Briefing and Scout pass, the Analyst
// works up every open candidate, and then all approvals from all sectors are
// ranked together and executed against ONE shared account, so position, sector
// and daily-loss limits apply across everything.

import { readChart } from './chart/read.js';
import { marketRegime, buildBriefing, newsTone } from './agents/briefing.js';
import { scout } from './agents/scout.js';
import { analyze, ANALYST_DEFAULTS } from './agents/analyst.js';
import { STOCK_RULES } from './agents/stocks.js';
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

// Crypto rules: the original desk.
const CRYPTO_RULES = {
  read: (m) => readChart(m.d1, m.h4 ?? null),
  brief: ({ group, reads, external, balance, config, now }) => {
    const valid = Object.values(reads).filter(Boolean);
    return buildBriefing({
      regime: marketRegime(group.regimeD1 ?? group.market.BTC?.d1),
      breadth: valid.length ? valid.filter((r) => r.d1.bar.close > r.d1.ema50).length / valid.length : null,
      fearGreed: external.fearGreed ?? null,
      news: group.headlines ? newsTone(group.headlines, now) : null,
      balance,
      shortsEnabled: !!config.allowShorts,
      now,
    });
  },
  scout: ({ sym, read, brief, now }) => scout({ sym, read, brief, now }),
  analyze: ({ sym, read, brief, candidate, reads, livePrice, group, config }) => analyze({
    sym, read, brief, candidate, btcRead: reads.BTC ?? null,
    fees: group.fees ?? config.fees, livePrice, config: group.analyst ?? config.analyst,
  }),
};

export const RULES = { crypto: CRYPTO_RULES, stock: STOCK_RULES };

// One sector: Briefing, exits on open positions, Scout, Analyst.
//   group:      { id, label, kind: 'crypto'|'stock', market: { SYM: { d1, h4? } }, regimeD1?, sectorD1?, headlines?, fees?, analyst? }
//   livePrices: { SYM: price } where fills happen (fresh prices only when config.requireLivePrice)
//   watch:      { SYM: scoutResult } carried between cycles for this group
export function analyzeGroup({ now, group, account, watch = {}, external = {}, livePrices = {}, prices = {}, config = DESK_CONFIG }) {
  const rules = RULES[group.kind] ?? CRYPTO_RULES;
  const reads = {};
  for (const [sym, m] of Object.entries(group.market)) reads[sym] = rules.read(m, group);
  const priceOf = (sym) => livePrices[sym] ?? reads[sym]?.price;

  // ── Agent 1: Briefing ─────────────────────────────────────────────────────
  const eq = equity(account, prices);
  const brief = rules.brief({
    group, reads, external, config, now,
    balance: { paper: { equity: eq, cash: account.cash }, coinbase: external.coinbase ?? null },
  });
  brief.group = { id: group.id, label: group.label, kind: group.kind };

  // ── Manage open positions in this group: trailing channel exit on the latest closed day ─
  const closed = [];
  for (const pos of Object.values(account.positions)) {
    if ((pos.sector ?? 'crypto') !== group.id) continue;
    const r = reads[pos.sym];
    if (!r || pos.managedBar === r.d1.bar.time || r.d1.bar.time < pos.signalBar) continue;
    if (config.requireLivePrice && livePrices[pos.sym] == null) continue; // no fresh price: decide next run
    pos.managedBar = r.d1.bar.time;
    pos.meta.exitLevel = pos.dir > 0 ? r.d1.exitLow : r.d1.exitHigh;
    const c = r.d1.bar.close;
    const exit = pos.dir > 0 ? c < r.d1.exitLowPrev : c > r.d1.exitHighPrev;
    if (exit && r.d1.bar.time > pos.signalBar) {
      closed.push(closePosition(account, pos.sym, priceOf(pos.sym), 'Trailing channel exit', now));
    }
  }

  // ── Agent 2: Scout ────────────────────────────────────────────────────────
  const scouts = [];
  for (const sym of Object.keys(group.market)) {
    const s = rules.scout({ sym, read: reads[sym], brief, now, group });
    s.held = !!account.positions[sym];
    s.sector = group.id;
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
  const analyses = [];
  for (const s of scouts) {
    if (s.verdict !== 'OPEN' || s.held) continue;
    const a = rules.analyze({ sym: s.sym, read: reads[s.sym], brief, candidate: s, reads, livePrice: priceOf(s.sym), group, config });
    a.fromWatch = !!watch[s.sym];
    a.sector = group.id;
    a.asset = group.kind;
    a.rank = a.rank ?? a.passed / Math.max(1, a.total);
    analyses.push(a);
  }
  analyses.sort((x, y) => y.rank - x.rank);

  return { brief, reads, scouts, analyses, closed, watch: nextWatch };
}

// Execute approvals from every group against the shared account, best-ranked first.
//   results:    [{ group, analyses, reads }] from analyzeGroup
//   holds:      { all: reason|null, groups: { id: reason }, syms: { SYM: reason } } — no new entries
export function executeApprovals({ now, account, results, livePrices = {}, prices = {}, holds = {}, config = DESK_CONFIG }) {
  account.signals ??= {};
  const pool = [];
  for (const { group, analyses, reads } of results) {
    for (const a of analyses) if (a.decision !== 'REJECT') pool.push({ a, group, read: reads[a.sym] });
  }
  pool.sort((x, y) => y.a.rank - x.a.rank);

  const opened = [];
  for (const { a, group, read } of pool) {
    const bar = read.d1.bar.time;
    if (account.signals[a.sym] === bar) { a.note = 'Already acted on this signal'; continue; }
    if (!config.execute) { a.note = 'Approved — auto-trading is paused, so nothing was opened'; continue; }
    const hold = holds.all ?? holds.groups?.[group.id] ?? holds.syms?.[a.sym];
    if (hold) { a.note = `Approved but not taken: ${hold}`; continue; }
    if (config.requireLivePrice && livePrices[a.sym] == null) { a.note = 'Approved but not taken: no live price right now — will re-check next run'; continue; }
    const block = entryBlock(account, now, prices, config.risk, group.id);
    if (block) { a.note = `Approved but not taken: ${block}`; continue; }
    const fees = group.fees ?? config.fees;
    const sizeUsd = sizeForRisk(equity(account, prices), account.cash, a.plan.entry, a.plan.stop, config.risk, fees);
    const pos = openPosition(account, {
      sym: a.sym, dir: a.dir, entry: a.plan.entry, stop: a.plan.stop, sizeUsd, asset: group.kind, sector: group.id,
      meta: { setup: a.setupLabel ?? (a.dir > 0 ? 'Breakout' : 'Breakdown'), checklist: a.checklist, summary: a.summary, exitLevel: a.plan.exitLevel, sectorLabel: group.label },
    }, now, fees);
    if (!pos) { a.note = 'Approved but position too small to open'; continue; }
    pos.signalBar = bar;
    account.signals[a.sym] = bar;
    a.note = `Opened ${a.dir > 0 ? 'long' : 'short'} — $${sizeUsd.toFixed(0)}`;
    a.sizeUsd = sizeUsd;
    opened.push(pos);
  }
  return opened;
}

// Whole desk, many groups. Returns per-group results plus what was opened/closed.
export function runDesk({ now, account, groups, watch = {}, external = {}, livePrices = {}, holds = {}, config = DESK_CONFIG }) {
  const prices = {};
  for (const g of groups) {
    for (const [sym, m] of Object.entries(g.market)) {
      const p = livePrices[sym] ?? m.d1[m.d1.length - 1]?.close;
      if (p != null) prices[sym] = p;
    }
  }
  const results = groups.map((group) => ({
    group,
    ...analyzeGroup({ now, group, account, watch: watch[group.id] ?? {}, external, livePrices, prices, config }),
  }));
  const opened = executeApprovals({ now, account, results, livePrices, prices, holds, config });
  markDay(account, now, prices);
  return {
    groups: results.map(({ group, brief, scouts, analyses, closed, watch: w, reads }) => ({ id: group.id, label: group.label, kind: group.kind, brief, scouts, analyses, closed, watch: w, reads })),
    opened,
    closed: results.flatMap((r) => r.closed),
  };
}

// Single crypto group — the original API, used by the crypto backtest.
//   market: { SYM: { d1, h4? } } — must include BTC
export function runCycle({ now, market, account, watch = {}, external = {}, livePrices = {}, holds = {}, config = DESK_CONFIG }) {
  const group = { id: 'crypto', label: 'Crypto', kind: 'crypto', market, headlines: external.headlines ?? null, fees: config.fees };
  const res = runDesk({ now, account, groups: [group], watch: { crypto: watch }, external, livePrices, holds, config });
  const g = res.groups[0];
  return { brief: g.brief, reads: g.reads, scouts: g.scouts, analyses: g.analyses, opened: res.opened, closed: res.closed, watch: g.watch };
}

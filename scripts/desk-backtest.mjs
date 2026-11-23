// Backtest the Trading Desk pipeline on daily candles, with fees and slippage.
//
//   node scripts/desk-backtest.mjs <dataDir> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--shorts] [--set path=value ...]
//
// <dataDir> holds one file per coin named <SYMBOL>_1d.json: an array of
// [timeMs, open, high, low, close, volume] rows, oldest first. BTC is required.
// Decisions use only candles that had closed; fills happen at the next day's open.

import fs from 'node:fs';
import path from 'node:path';
import { runCycle, DESK_CONFIG } from '../src/desk/pipeline.js';
import { newAccount, stepPosition, markDay, equity, summarize } from '../src/desk/engine/account.js';

const DAY = 86_400_000;
const args = process.argv.slice(2);
const dataDir = args[0];
if (!dataDir) { console.error('usage: node scripts/desk-backtest.mjs <dataDir> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--shorts]'); process.exit(1); }
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const from = opt('--from') ? Date.parse(opt('--from')) : -Infinity;
const to = opt('--to') ? Date.parse(opt('--to')) : Infinity;

const config = structuredClone(DESK_CONFIG);
if (args.includes('--shorts')) config.allowShorts = true;
args.forEach((a, i) => {
  if (a !== '--set') return;
  const [k, v] = args[i + 1].split('=');
  const keys = k.split('.');
  let o = config;
  for (const key of keys.slice(0, -1)) o = o[key];
  o[keys.at(-1)] = Number(v);
});

const data = {};
for (const f of fs.readdirSync(dataDir)) {
  const m = f.match(/^([A-Z0-9]+)_1d\.json$/);
  if (!m) continue;
  data[m[1]] = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'))
    .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
}
if (!data.BTC) { console.error('BTC_1d.json is required'); process.exit(1); }
const syms = Object.keys(data).sort();
const index = Object.fromEntries(syms.map((s) => [s, new Map(data[s].map((c, i) => [c.time, i]))]));

const acct = newAccount(5000, data.BTC[0].time);
let watch = {};
const curve = [];
let watchSaved = 0, watchTriggered = 0, scoutOpen = 0, rejected = 0;
const prevWatch = new Set();

for (let i = 200; i < data.BTC.length - 1; i++) {
  const t = data.BTC[i].time;
  if (t < from || t > to) continue;
  const now = t + DAY;
  const market = {}, livePrices = {}, next = {};
  for (const s of syms) {
    const k = index[s].get(t);
    if (k == null || k < 60) continue;
    market[s] = { d1: data[s].slice(Math.max(0, k - 299), k + 1) };
    const nx = data[s][k + 1];
    if (nx) { livePrices[s] = nx.open; next[s] = nx; }
  }
  const res = runCycle({ now, market, account: acct, watch, livePrices, config });
  for (const s of res.scouts) if (s.verdict === 'OPEN' && !s.held) { scoutOpen++; if (prevWatch.has(s.sym)) watchTriggered++; }
  for (const s of Object.keys(res.watch)) if (!prevWatch.has(s)) watchSaved++;
  prevWatch.clear(); Object.keys(res.watch).forEach((s) => prevWatch.add(s));
  rejected += res.analyses.filter((a) => a.decision === 'REJECT').length;
  watch = res.watch;

  const closes = {};
  for (const [s, c] of Object.entries(next)) { stepPosition(acct, s, c, null, config.fees); closes[s] = c.close; }
  curve.push({ t: now, equity: markDay(acct, now + DAY - 1, closes) });
}

// ── Report ───────────────────────────────────────────────────────────────────
const sum = summarize(acct);
let peak = -Infinity, maxDd = 0;
for (const p of curve) { peak = Math.max(peak, p.equity); maxDd = Math.max(maxDd, (peak - p.equity) / peak); }
const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const d = (t) => new Date(t).toISOString().slice(0, 10);
const line = (label, trades) => {
  if (!trades.length) return `${label.padEnd(14)} no trades`;
  const w = trades.filter((x) => x.net > 0);
  const gw = w.reduce((s, x) => s + x.net, 0), gl = -trades.filter((x) => x.net <= 0).reduce((s, x) => s + x.net, 0);
  return `${label.padEnd(14)} trades ${String(trades.length).padStart(3)}  win ${String(Math.round((w.length / trades.length) * 100)).padStart(2)}%  net $${trades.reduce((s, x) => s + x.net, 0).toFixed(0).padStart(6)}  PF ${(gl ? gw / gl : Infinity).toFixed(2)}  avg ${(trades.reduce((s, x) => s + x.r, 0) / trades.length).toFixed(2)}R  avg hold ${(trades.reduce((s, x) => s + (x.exitTime - x.entryTime), 0) / trades.length / DAY).toFixed(0)}d`;
};

console.log(`Trading Desk backtest  ${d(curve[0].t)} → ${d(curve.at(-1).t)}   coins: ${syms.join(' ')}`);
console.log(`Fees: taker ${(config.fees.taker * 100).toFixed(2)}%  slippage ${(config.fees.slippage * 100).toFixed(2)}%   risk/trade ${config.risk.riskPerTradePct}%   shorts ${config.allowShorts ? 'on (paper)' : 'off'}`);
console.log(`\nStart $${acct.startBalance}  →  End $${sum.equity.toFixed(0)}  (${pct(sum.totalPct)})   max drawdown -${(maxDd * 100).toFixed(1)}%   fees paid $${sum.feesPaid.toFixed(0)}`);
console.log(`Days: ${sum.greenDays} green / ${sum.redDays} red / ${sum.days.length - sum.greenDays - sum.redDays} flat (no position)`);
console.log(`Scout: ${scoutOpen} open opportunities, ${watchSaved} saved for later (${watchTriggered} of those later triggered); Analyst rejected ${rejected}\n`);
console.log(line('All', acct.trades));
console.log(line('Longs', acct.trades.filter((x) => x.dir > 0)));
console.log(line('Shorts', acct.trades.filter((x) => x.dir < 0)));
console.log('\nBy year:');
const years = [...new Set(curve.map((p) => new Date(p.t).getUTCFullYear()))];
let startEq = acct.startBalance;
for (const y of years) {
  const pts = curve.filter((p) => new Date(p.t).getUTCFullYear() === y);
  const endEq = pts.at(-1).equity;
  console.log(`  ${y}  ${pct(((endEq - startEq) / startEq) * 100).padStart(7)}   ${line('', acct.trades.filter((x) => new Date(x.entryTime).getUTCFullYear() === y)).trim()}`);
  startEq = endEq;
}
if (Object.keys(acct.positions).length) console.log(`\nStill open: ${Object.values(acct.positions).map((p) => `${p.dir > 0 ? 'long' : 'short'} ${p.sym}`).join(', ')}`);
if (args.includes('--trades')) for (const x of [...acct.trades].reverse()) console.log(`${d(x.entryTime)} → ${d(x.exitTime)}  ${x.dir > 0 ? 'LONG ' : 'SHORT'} ${x.sym.padEnd(5)} ${pct(x.netPct).padStart(7)}  ${x.r.toFixed(2).padStart(6)}R  checks ${x.meta.checklist}  ${x.reason}`);
if (args.includes('--json')) fs.writeFileSync(opt('--json'), JSON.stringify({ curve, trades: acct.trades, summary: sum }));

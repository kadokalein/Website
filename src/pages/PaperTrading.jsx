import { useState } from 'react';
import { Link } from 'react-router-dom';
import AppNav from '../components/AppNav';
import { useDesk } from '../desk/DeskProvider';
import { positionValue, dayKey } from '../desk/engine/account';
import { Badge, Card, SectionLabel, CoinChip, Stat, BTN } from '../desk/ui/atoms';
import { fmtUsd, fmtPrice, fmtPct, timeAgo, fmtDate, coinMeta } from '../desk/ui/format';

const DAY = 86_400_000;
const STRIP_DAYS = 60;
const TRADES_SHOWN = 25;

const toneFor = (v) => (v == null || Math.abs(v) < 0.005 ? 'text-white' : v > 0 ? 'text-green-400' : 'text-red-400');

function SideBadge({ dir }) {
  return dir < 0 ? <Badge tone="red">Short</Badge> : <Badge tone="green">Long</Badge>;
}

function Toggle({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full border transition-colors ${
        on ? 'bg-green-500/30 border-green-500/50' : 'bg-[#21262d] border-[#30363d]'}`}>
      <span className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${on ? 'translate-x-[18px] bg-green-400' : 'translate-x-[3px] bg-[#8b949e]'}`} />
    </button>
  );
}

// ─── Daily results ────────────────────────────────────────────────────────────
// The strip ends on the most recent day the desk ran (normally today).
function DailyResults({ summary, lastRun }) {
  const byDay = new Map(summary.days.map((d) => [d.day, d]));
  const today = Math.max(lastRun ?? 0, ...summary.days.map((d) => Date.parse(d.day)));
  const lastDays = Array.from({ length: STRIP_DAYS }, (_, i) => dayKey(today - (STRIP_DAYS - 1 - i) * DAY));
  const first = lastDays.findIndex((k) => byDay.has(k));
  const strip = first === -1 ? [] : lastDays.slice(first);
  const flat = Math.max(0, summary.days.length - summary.greenDays - summary.redDays);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div className="text-sm font-semibold">Daily results</div>
        <SectionLabel>Last {STRIP_DAYS} days</SectionLabel>
      </div>
      {strip.length === 0 ? (
        <div className="text-sm text-[#8b949e]">No days recorded yet. A day appears here once the desk has run on it.</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            {strip.map((k) => {
              const d = byDay.get(k);
              if (!d) {
                return <span key={k} title={`${k}: no record (the desk did not run)`} className="w-3.5 h-3.5 rounded-sm border border-dashed border-[#30363d]" />;
              }
              const cls = d.pnl > 0.005 ? 'bg-[#3fb950]' : d.pnl < -0.005 ? 'bg-[#f85149]' : 'bg-[#30363d]';
              return <span key={k} title={`${k}: ${fmtUsd(d.pnl)} (${fmtPct(d.pct, 2)})`} className={`w-3.5 h-3.5 rounded-sm ${cls}`} />;
            })}
          </div>
          <div className="text-xs text-[#8b949e] mt-3">
            <span className="text-green-400 font-mono">{summary.greenDays}</span> green days,{' '}
            <span className="text-red-400 font-mono">{summary.redDays}</span> red days,{' '}
            <span className="font-mono text-white">{flat}</span> flat (no position)
          </div>
        </>
      )}
      <div className="text-[11px] text-[#484f58] mt-1">
        Flat days are normal: the desk sits in cash whenever no chart qualifies, which is most days.
      </div>
    </Card>
  );
}

// ─── Open positions ───────────────────────────────────────────────────────────
function PositionRow({ pos, price, onClose }) {
  const meta = coinMeta(pos.sym);
  const upnl = positionValue(pos, price) - pos.notional;
  const upnlPct = pos.notional ? (upnl / pos.notional) * 100 : 0;
  const stopDist = price ? ((pos.stop - price) / price) * 100 : null;
  const exitLevel = pos.meta?.exitLevel;

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <CoinChip sym={pos.sym} />
        <div className="flex-1 min-w-[120px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{pos.sym}</span>
            <span className="text-[11px] text-[#8b949e] truncate">{meta.name}</span>
            <SideBadge dir={pos.dir} />
          </div>
          <div className="text-[11px] text-[#8b949e] mt-0.5">
            Entry <span className="font-mono text-white">{fmtPrice(pos.entry)}</span> on {fmtDate(pos.entryTime)}
            <span className="text-[#484f58]"> · </span>
            Size <span className="font-mono text-white">{fmtUsd(pos.notional)}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-mono font-bold">{fmtPrice(price)}</div>
          <div className={`text-[11px] font-mono ${toneFor(upnl)}`}>
            {upnl >= 0 ? '+' : ''}{fmtUsd(upnl)} ({fmtPct(upnlPct, 2)})
          </div>
        </div>
        <button type="button" onClick={onClose}
          className="px-3 py-1.5 rounded-md text-xs bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors">
          Close now
        </button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#8b949e]">
        <span>
          Stop <span className="font-mono text-white">{fmtPrice(pos.stop)}</span>
          {stopDist != null && <span className="font-mono text-[#484f58]"> ({fmtPct(stopDist, 1)} away)</span>}
        </span>
        {exitLevel != null && (
          <span>
            Trailing exit: daily close {pos.dir < 0 ? 'above' : 'below'} <span className="font-mono text-white">{fmtPrice(exitLevel)}</span>
          </span>
        )}
      </div>
      {pos.meta?.summary && <div className="text-[11px] text-[#8b949e] leading-relaxed">{pos.meta.summary}</div>}
    </div>
  );
}

// ─── Closed trades ────────────────────────────────────────────────────────────
function ClosedTrades({ trades }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? trades : trades.slice(0, TRADES_SHOWN);

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-[#30363d] flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">Closed trades <span className="text-[#8b949e] font-normal">({trades.length})</span></div>
        {trades.length > TRADES_SHOWN && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className={BTN}>
            {showAll ? `Show latest ${TRADES_SHOWN}` : `Show all ${trades.length}`}
          </button>
        )}
      </div>
      {trades.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-[#8b949e]">No closed trades yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[11px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-[#484f58] border-b border-[#30363d]">
                <th className="px-4 py-2 font-semibold">Dates</th>
                <th className="px-2 py-2 font-semibold">Coin</th>
                <th className="px-2 py-2 font-semibold">Side</th>
                <th className="px-2 py-2 font-semibold">Entry → Exit</th>
                <th className="px-2 py-2 font-semibold text-right">Net</th>
                <th className="px-2 py-2 font-semibold text-right">%</th>
                <th className="px-2 py-2 font-semibold text-right">R</th>
                <th className="px-2 py-2 font-semibold text-right">Fees</th>
                <th className="px-4 py-2 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {rows.map((t) => (
                <tr key={`${t.id}-${t.exitTime}`} className="align-middle">
                  <td className="px-4 py-2 whitespace-nowrap text-[#8b949e]">{fmtDate(t.entryTime)} → {fmtDate(t.exitTime)}</td>
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <CoinChip sym={t.sym} size="sm" />
                      <span className="font-semibold text-xs">{t.sym}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2"><SideBadge dir={t.dir} /></td>
                  <td className="px-2 py-2 font-mono whitespace-nowrap text-[#8b949e]">{fmtPrice(t.entry)} → {fmtPrice(t.exit)}</td>
                  <td className={`px-2 py-2 font-mono text-right whitespace-nowrap ${toneFor(t.net)}`}>{t.net >= 0 ? '+' : ''}{fmtUsd(t.net)}</td>
                  <td className={`px-2 py-2 font-mono text-right whitespace-nowrap ${toneFor(t.netPct)}`}>{fmtPct(t.netPct, 2)}</td>
                  <td className={`px-2 py-2 font-mono text-right whitespace-nowrap ${toneFor(t.r)}`}>{t.r != null ? `${t.r.toFixed(2)}R` : '—'}</td>
                  <td className="px-2 py-2 font-mono text-right whitespace-nowrap text-[#8b949e]">{fmtUsd(t.fees)}</td>
                  <td className="px-4 py-2 text-[#8b949e]">{t.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function Settings({ settings, risk, actions }) {
  const rules = [
    ['Risk per trade', `${risk.riskPerTradePct}% of equity, fees included, if the stop is hit`],
    ['Max position size', `${risk.maxPositionPct}% of equity`],
    ['Max open positions', String(risk.maxPositions)],
    ['Max new trades per day', String(risk.maxNewTradesPerDay)],
    ['Daily loss limit', `${risk.dailyLossLimitPct}% — no new entries for the rest of the day`],
    ['Max open risk', `${risk.maxOpenRiskPct}% of equity across all open stops`],
  ];

  function handleReset() {
    if (!confirm('Reset the paper account to $5,000 and erase its history?')) return;
    actions.reset();
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="text-sm font-semibold">Settings</div>

      <div className="flex items-start gap-3">
        <Toggle on={!!settings.auto} onChange={actions.setAuto} label="Auto-trading" />
        <div className="min-w-0">
          <div className="text-sm">
            Auto-trading{' '}
            {settings.auto ? <Badge tone="green">On</Badge> : <Badge tone="yellow">Paused</Badge>}
          </div>
          <div className="text-[11px] text-[#8b949e] mt-0.5 leading-relaxed">
            On: the desk opens the paper trades its Analyst approves. Paused: it keeps analysing and still manages exits on open positions, but opens nothing new.
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3">
        <Toggle on={!!settings.shorts} onChange={actions.setShorts} label="Allow paper shorts" />
        <div className="min-w-0">
          <div className="text-sm">
            Allow paper shorts{' '}
            {settings.shorts ? <Badge tone="orange">On</Badge> : <Badge tone="grey">Off</Badge>}
          </div>
          <div className="text-[11px] text-[#8b949e] mt-0.5 leading-relaxed">
            Off by default. Shorts lost money in backtests and Coinbase spot accounts cannot short, so this is an experiment for the paper account only.
          </div>
        </div>
      </div>

      <div>
        <SectionLabel className="mb-2">Risk rules</SectionLabel>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
          {rules.map(([k, v]) => (
            <div key={k} className="flex flex-wrap justify-between gap-x-3 border-b border-[#30363d]/60 pb-1">
              <dt className="text-[#8b949e]">{k}</dt>
              <dd className="font-mono text-white text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="pt-1">
        <button type="button" onClick={handleReset}
          className="px-3 py-1.5 rounded-md text-xs bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors">
          Reset paper account
        </button>
        <div className="text-[10px] text-[#484f58] mt-1">Puts the account back to $5,000 and erases its trades and daily history.</div>
      </div>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PaperTrading() {
  const { state, status, prices, summary, actions, config } = useDesk();
  const account = state.account ?? { cash: 0, positions: {}, trades: [] };
  const positions = Object.values(account.positions ?? {});
  const trades = account.trades ?? [];
  const risk = config.risk;
  const equity = summary.equity;
  const idlePct = equity > 0 ? (account.cash / equity) * 100 : 0;

  function handleClose(sym) {
    if (!confirm(`Close the ${sym} paper position at the live price?`)) return;
    actions.closePosition(sym);
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <AppNav badge={{ text: 'SIMULATED', tone: 'blue' }} actions={<Link to="/desk" className={BTN}>Open Trading Desk</Link>} />

      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="space-y-1">
          <p className="text-sm text-[#8b949e] leading-relaxed">
            This is the paper account the Trading Desk trades — $5,000 of simulated money that pays real Coinbase fees
            ({(config.fees.taker * 100).toFixed(1)}% per side) and slippage, so the numbers here are what live trading would have looked like.
          </p>
          <div className="text-[11px] text-[#484f58]">
            {status.running
              ? `The desk is running now${status.detail ? ` — ${status.detail}` : ''}.`
              : `Last desk run ${timeAgo(status.lastRun)}.`}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Stat label="Account value" value={fmtUsd(equity)}
            sub={<span className={`font-mono ${toneFor(summary.totalPct)}`}>{fmtPct(summary.totalPct, 2)} total</span>} />
          <Stat label="Cash" value={fmtUsd(account.cash)} sub={`${idlePct.toFixed(0)}% idle`} />
          <Stat label="Closed trades" value={summary.trades}
            sub={summary.winRate != null ? `${summary.winRate.toFixed(0)}% win rate` : '—'} />
          <Stat label="Profit factor" value={summary.profitFactor != null ? summary.profitFactor.toFixed(2) : '—'} sub="wins ÷ losses" />
          <Stat label="Average result" value={summary.avgR != null ? `${summary.avgR.toFixed(2)}R` : '—'}
            tone={toneFor(summary.avgR)} sub="per trade, in units of risk" />
          <Stat label="Fees paid" value={fmtUsd(summary.feesPaid)} sub="included in every number" />
        </div>

        <DailyResults summary={summary} lastRun={status.lastRun} />

        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-[#30363d] flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">
              Open positions <span className="text-[#8b949e] font-normal">({positions.length}/{risk.maxPositions})</span>
            </div>
          </div>
          {positions.length === 0 ? (
            <div className="px-4 py-6 text-sm text-[#8b949e] leading-relaxed">
              No open positions. The desk only opens a trade when a chart closes through its line in an allowed direction — see the{' '}
              <Link to="/desk" className="text-[#58a6ff] hover:underline">Trading Desk</Link> for today's call.
            </div>
          ) : (
            <div className="divide-y divide-[#30363d]">
              {positions.map((pos) => (
                <PositionRow key={pos.sym} pos={pos} price={prices[pos.sym] ?? pos.lastPrice ?? pos.entry}
                  onClose={() => handleClose(pos.sym)} />
              ))}
            </div>
          )}
        </Card>

        <ClosedTrades trades={trades} />

        <Settings settings={state.settings ?? {}} risk={risk} actions={actions} />
      </main>
    </div>
  );
}

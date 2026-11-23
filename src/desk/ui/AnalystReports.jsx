// Agent 3 · Analyst — the full work-up for every coin the Scout handed over,
// plus the positions it is managing. Charts only load when asked for.
import { useState } from 'react';
import { useDesk } from '../DeskProvider';
import { positionValue } from '../engine/account';
import DeskChart from './DeskChart';
import { Badge, Card, SectionLabel, CoinChip, BTN } from './atoms';
import { fmtUsd, fmtPrice, fmtPct, fmtDate, coinMeta } from './format';

const EXPLAIN = 'The full chart work-up for every coin the Scout passed on. The must-pass checks decide; the rest is the supporting evidence.';
const EMPTY = 'No coin reached the Analyst today. That is the normal state on most days — the desk only acts when a chart closes through its line in the direction the Briefing allows.';
const FOOTNOTE = 'In backtests, no single supporting check reliably separated winners from losers, which is why they inform the report but do not veto a trade.';
const FEES_TIP = 'Round-trip fees as a fraction of the amount risked. 0.30R means fees eat 30% of what the trade stands to lose at the stop.';

const DECISIONS = {
  BUY: { tone: 'green', box: 'border-green-500/30' },
  SHORT: { tone: 'red', box: 'border-red-500/30' },
  REJECT: { tone: 'grey', box: 'border-[#30363d]' },
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pnlTone = (v) => (!isNum(v) || v === 0 ? 'text-[#8b949e]' : v > 0 ? 'text-green-400' : 'text-red-400');

function Mark({ pass }) {
  return (
    <span className={`mt-0.5 w-4 h-4 rounded-full flex-shrink-0 inline-flex items-center justify-center ${pass ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {pass ? <path d="M2.5 6.5l2.5 2.5 4.5-5.5" /> : <path d="M3 3l6 6M9 3l-6 6" />}
      </svg>
      <span className="sr-only">{pass ? 'Passed:' : 'Failed:'}</span>
    </span>
  );
}

function Checklist({ title, hint, items }) {
  const list = items ?? [];
  const passed = list.filter((c) => c.pass).length;
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#1c2128] p-3 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-2">
        <SectionLabel>{title}</SectionLabel>
        <span className="text-[10px] font-mono text-[#8b949e]">{passed}/{list.length}</span>
        {hint && <span className="text-[10px] text-[#484f58]">{hint}</span>}
      </div>
      {list.length === 0 ? <p className="text-xs text-[#8b949e]">No checks were recorded.</p> : (
        <ul className="space-y-2">
          {list.map((c) => (
            <li key={c.name} className="flex items-start gap-2">
              <Mark pass={c.pass} />
              <div className="min-w-0">
                <div className="text-xs text-white">{c.name}</div>
                {c.detail && <div className="text-[11px] text-[#8b949e] leading-relaxed break-words">{c.detail}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Cell({ label, value, sub, subTone = 'text-[#8b949e]', title, tone = 'text-white' }) {
  return (
    <div title={title} className="min-w-0">
      <div className="text-[10px] text-[#8b949e]">{label}</div>
      <div className={`font-mono text-sm ${tone}`}>
        {value}
        {sub && <span className={`text-[11px] ml-1.5 ${subTone}`}>{sub}</span>}
      </div>
    </div>
  );
}

function ChartButton({ open, onClick, sym }) {
  return (
    <button type="button" className={BTN} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} the ${sym} chart`} onClick={onClick}>
      {open ? 'Hide chart' : 'Show chart'}
    </button>
  );
}

function Plan({ analysis }) {
  const { plan, decision, sizeUsd } = analysis;
  if (!plan) return null;
  const long = (plan.dir ?? analysis.dir) > 0;
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#1c2128] p-3">
      <SectionLabel className="mb-2">{decision === 'REJECT' ? 'Plan — not taken' : 'Plan'}</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3">
        <Cell label="Entry" value={fmtPrice(plan.entry)} />
        <Cell
          label="Stop"
          value={fmtPrice(plan.stop)}
          sub={isNum(plan.stopPct) ? `${long ? '-' : '+'}${plan.stopPct.toFixed(1)}%` : null}
          subTone="text-red-400"
          title="Initial stop and its distance from the entry: 3 daily ATRs"
        />
        <Cell label="Trailing exit" value={fmtPrice(plan.exitLevel)} title="The level a daily close has to cross to trigger the trailing exit. It moves with the chart." />
        <Cell label="Fees" value={isNum(plan.feesR) ? `${plan.feesR.toFixed(2)}R` : '—'} title={FEES_TIP} />
        {isNum(sizeUsd) && <Cell label="Size" value={fmtUsd(sizeUsd)} title="Paper position size, set so a stop-out costs about 1% of equity" />}
      </div>
      {plan.exitRule && <p className="text-[11px] text-[#8b949e] mt-3 leading-relaxed break-words">{plan.exitRule}.</p>}
    </div>
  );
}

function Report({ analysis, chartOpen, onToggleChart }) {
  const { sym, decision } = analysis;
  const d = DECISIONS[decision] ?? DECISIONS.REJECT;
  const meta = coinMeta(sym);
  const opened = isNum(analysis.sizeUsd);

  return (
    <li className={`rounded-lg border ${d.box} bg-[#0d1117]/40 p-3 space-y-3`}>
      <div className="flex items-start gap-2.5">
        <CoinChip sym={sym} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-white">{sym}</span>
            {meta.name !== sym && <span className="text-xs text-[#8b949e]">{meta.name}</span>}
            <Badge tone={d.tone}>{decision}</Badge>
            {analysis.fromWatch && <Badge tone="yellow" title="This coin was on the Scout's saved-for-later list before it triggered">from saved list</Badge>}
            <span className="text-[11px] text-[#8b949e]">supporting checks <span className="font-mono text-white">{analysis.checklist}</span></span>
          </div>
          {analysis.summary && <p className="text-sm text-white mt-1.5 leading-relaxed break-words">{analysis.summary}</p>}
        </div>
      </div>

      {analysis.note && (
        <div className={`rounded-lg border px-3 py-2 ${opened ? 'border-green-500/30 bg-green-500/10' : 'border-yellow-500/25 bg-yellow-500/10'}`}>
          <SectionLabel className={opened ? '!text-green-400' : '!text-yellow-400'}>What happened</SectionLabel>
          <p className="text-sm font-semibold text-white mt-0.5 break-words">{analysis.note}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Checklist title="Must pass" hint="every one has to pass" items={analysis.must} />
        <Checklist title="Supporting chart work" hint="informs, does not veto" items={analysis.scored} />
      </div>

      <Plan analysis={analysis} />

      <div>
        <ChartButton open={chartOpen} onClick={onToggleChart} sym={sym} />
        {chartOpen && <div className="mt-3 min-w-0"><DeskChart sym={sym} plan={analysis.plan} /></div>}
      </div>
    </li>
  );
}

function PositionCard({ pos, price, chartOpen, onToggleChart }) {
  const { sym } = pos;
  const long = pos.dir > 0;
  const live = price ?? pos.lastPrice ?? pos.entry;
  const pnl = positionValue(pos, live) - pos.notional;
  const pct = pos.notional ? (pnl / pos.notional) * 100 : null;
  const tone = pnlTone(pnl);
  const meta = coinMeta(sym);

  return (
    <li className="rounded-lg border border-[#30363d] bg-[#1c2128] p-3 space-y-3">
      <div className="flex items-start gap-2.5">
        <CoinChip sym={sym} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-white">{sym}</span>
            {meta.name !== sym && <span className="text-xs text-[#8b949e]">{meta.name}</span>}
            <Badge tone={long ? 'green' : 'red'}>{long ? 'Long' : 'Short'}</Badge>
            {pos.meta?.setup && <Badge>{pos.meta.setup}</Badge>}
            <span className="text-[11px] text-[#8b949e]">
              {fmtUsd(pos.notional, 0)} opened {fmtDate(pos.entryTime)}
              {pos.meta?.checklist ? <> · supporting checks <span className="font-mono">{pos.meta.checklist}</span></> : null}
            </span>
          </div>
          {pos.meta?.summary && <p className="text-xs text-[#8b949e] mt-1.5 leading-relaxed break-words">{pos.meta.summary}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3">
        <Cell label="Entry" value={fmtPrice(pos.entry)} title="The simulated fill, including slippage" />
        <Cell label="Live price" value={fmtPrice(live)} />
        <Cell
          label="Unrealised P&L"
          value={`${pnl > 0 ? '+' : ''}${fmtUsd(pnl)}`}
          sub={fmtPct(pct)}
          tone={tone}
          subTone={tone}
          title="Before the exit fee. The entry fee has already been paid."
        />
        <Cell label="Stop" value={fmtPrice(pos.stop)} tone="text-red-400" title="A touch of this price closes the position" />
        <Cell label="Trailing exit" value={fmtPrice(pos.meta?.exitLevel)} title="A daily close through this level closes the position. It moves with the chart." />
      </div>

      <div>
        <ChartButton open={chartOpen} onClick={onToggleChart} sym={sym} />
        {chartOpen && <div className="mt-3 min-w-0"><DeskChart sym={sym} position={pos} /></div>}
      </div>
    </li>
  );
}

export default function AnalystReports() {
  const { state, prices } = useDesk();
  const [chart, setChart] = useState(null); // 'report:SYM' | 'position:SYM' — one chart at a time
  const toggle = (key) => setChart((cur) => (cur === key ? null : key));

  const last = state.last;
  const analyses = last?.analyses ?? [];
  const positions = Object.values(state.account?.positions ?? {}).sort((a, b) => (a.entryTime ?? 0) - (b.entryTime ?? 0));
  const approved = analyses.filter((a) => a.decision !== 'REJECT').length;
  const nothing = analyses.length === 0 && positions.length === 0;

  return (
    <Card className="p-4 space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-white">Agent 3 · Analyst</h2>
          {last && <Badge tone={approved ? 'green' : 'grey'}>{approved} approved</Badge>}
          {last && analyses.length - approved > 0 && <Badge>{analyses.length - approved} rejected</Badge>}
          {positions.length > 0 && <Badge tone="blue">{positions.length} open position{positions.length === 1 ? '' : 's'}</Badge>}
        </div>
        <p className="text-xs text-[#8b949e] mt-1.5 leading-relaxed">{EXPLAIN}</p>
      </div>

      {!last && (
        <p className="text-xs text-[#8b949e]">The first run is still in progress. Reports appear here if the Scout hands a coin over.</p>
      )}

      {last && nothing && (
        <p className="text-sm text-[#8b949e] leading-relaxed rounded-lg border border-dashed border-[#30363d] px-3 py-3">{EMPTY}</p>
      )}

      {last && !nothing && (
        <section>
          <SectionLabel className="mb-2">Reports from this run</SectionLabel>
          {analyses.length === 0 ? (
            <p className="text-xs text-[#8b949e]">No new coin reached the Analyst on this run. It is only managing the open position{positions.length === 1 ? '' : 's'} below.</p>
          ) : (
            <ul className="space-y-3">
              {analyses.map((a) => {
                const key = `report:${a.sym}`;
                return <Report key={key} analysis={a} chartOpen={chart === key} onToggleChart={() => toggle(key)} />;
              })}
            </ul>
          )}
        </section>
      )}

      {positions.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-white mb-0.5">Positions the Analyst is managing</h3>
          <p className="text-[11px] text-[#8b949e] mb-2 leading-relaxed">Paper positions. Each one is closed at its stop, or on a daily close through its trailing-exit level.</p>
          <ul className="space-y-3">
            {positions.map((pos) => {
              const key = `position:${pos.sym}`;
              return <PositionCard key={key} pos={pos} price={prices?.[pos.sym]} chartOpen={chart === key} onToggleChart={() => toggle(key)} />;
            })}
          </ul>
        </section>
      )}

      <p className="text-[11px] text-[#484f58] leading-relaxed border-t border-[#30363d] pt-3">{FOOTNOTE}</p>
    </Card>
  );
}

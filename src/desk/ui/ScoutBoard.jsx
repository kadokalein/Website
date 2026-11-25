// Agent 2 · Scout — the quick look at every chart: what closed through its line
// today, what is saved for later, and what was passed over. Charts only load
// when a row or the chart room is opened.
import { useState } from 'react';
import { useDesk } from '../DeskProvider';
import DeskChart from './DeskChart';
import { Badge, Card, SectionLabel, CoinChip, BTN } from './atoms';
import { fmtPrice, coinMeta } from './format';
import SectorTabs from './SectorTabs';
import { groupTone, rememberTab, recallTab } from './tabs';

const DAY_MS = 86_400_000;
const EXPLAIN = 'A quick look at every chart with the lines drawn. A coin or stock only moves on to the Analyst when its latest daily candle closes through its breakout line.';

const VERDICTS = {
  OPEN: { label: 'Open now', tone: 'green' },
  WATCH: { label: 'Saved for later', tone: 'yellow' },
  PASS: { label: 'Passed', tone: 'grey' },
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const bySym = (a, b) => a.sym.localeCompare(b.sym);

function daysLeftText(expires, now = Date.now()) {
  if (!isNum(expires)) return null;
  const days = Math.ceil((expires - now) / DAY_MS);
  if (days <= 0) return 'expires today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

const CHIP_TONES = {
  grey: 'text-[#8b949e] border-[#30363d]',
  green: 'text-green-400 border-green-500/30',
  red: 'text-red-400 border-red-500/30',
};

function Chip({ tone = 'grey', title, children }) {
  return (
    <span title={title} className={`px-1.5 py-0.5 rounded border bg-[#0d1117] text-[10px] font-mono whitespace-nowrap ${CHIP_TONES[tone]}`}>
      {children}
    </span>
  );
}

// RSI, volume and ADX stay grey: on their own they are not good or bad news.
function IndicatorChips({ ind }) {
  if (!ind) return null;
  const chips = [];
  if (isNum(ind.rsi)) chips.push(<Chip key="rsi" title="Daily RSI (14). Above 70 is stretched, below 30 is washed out.">RSI {ind.rsi.toFixed(0)}</Chip>);
  if (ind.macd) chips.push(<Chip key="macd" tone={ind.macd === 'bullish' ? 'green' : ind.macd === 'bearish' ? 'red' : 'grey'} title="Daily MACD">MACD {ind.macd}</Chip>);
  if (isNum(ind.volRatio)) chips.push(<Chip key="vol" title="Latest daily volume against its 20-day average">Vol {ind.volRatio.toFixed(1)}×</Chip>);
  if (isNum(ind.adx)) chips.push(<Chip key="adx" title="Trend strength. Above about 25 means a trend is in force, in either direction.">ADX {ind.adx.toFixed(0)}</Chip>);
  if (ind.trend) chips.push(<Chip key="trend" tone={ind.trend === 'up' ? 'green' : ind.trend === 'down' ? 'red' : 'grey'} title="Daily trend from the moving averages">Trend {ind.trend}</Chip>);
  if (!chips.length) return null;
  return <div className="flex flex-wrap gap-1">{chips}</div>;
}

function LinesList({ lines }) {
  if (!lines?.length) return <p className="text-xs text-[#8b949e]">No lines could be drawn for this chart yet.</p>;
  return (
    <ul className="space-y-1.5">
      {lines.map((l) => (
        <li key={l} className="flex gap-2 text-xs text-[#8b949e] leading-relaxed">
          <span className="w-1 h-1 rounded-full bg-[#484f58] flex-shrink-0 mt-[7px]" aria-hidden="true" />
          <span className="break-words min-w-0">{l}</span>
        </li>
      ))}
    </ul>
  );
}

// The lines in words beside the same lines on the chart.
function LinesAndChart({ sym, lines }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-3">
      <div className="min-w-0">
        <SectionLabel className="mb-2">Lines drawn</SectionLabel>
        <LinesList lines={lines} />
      </div>
      <div className="min-w-0">
        <DeskChart sym={sym} />
      </div>
    </div>
  );
}

function ChartToggle({ open, onClick, sym }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} the ${sym} chart`}
      className={`flex-shrink-0 px-2 py-1 rounded-md text-[11px] border transition-colors ${
        open ? 'bg-[#58a6ff]/15 border-[#58a6ff]/40 text-[#58a6ff]' : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:text-white'
      }`}
    >
      {open ? 'Hide chart' : 'Chart'}
    </button>
  );
}

const ROW_BOX = {
  open: 'rounded-lg border border-green-500/30 bg-green-500/10 p-3',
  watch: 'rounded-lg border border-[#30363d] bg-[#1c2128] p-3',
  pass: 'rounded-lg border border-[#21262d] bg-[#0d1117]/40 px-3 py-2',
};

function ScoutRow({ scout, variant, price, open, onToggle }) {
  const { sym } = scout;
  const meta = coinMeta(sym);
  const left = variant === 'watch' ? daysLeftText(scout.expires) : null;
  const showDir = variant !== 'pass' && (scout.dir === 1 || scout.dir === -1);

  return (
    <li className={ROW_BOX[variant]}>
      <div className="flex items-start gap-2.5">
        <CoinChip sym={sym} size="sm" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-white">{sym}</span>
            {meta.name !== sym && <span className="text-xs text-[#8b949e]">{meta.name}</span>}
            {showDir && <Badge tone={scout.dir === 1 ? 'green' : 'red'}>{scout.dir === 1 ? 'Long setup' : 'Short setup'}</Badge>}
            {scout.held && <Badge tone="blue" title="The paper account already holds this, so no new trade is opened">Holding</Badge>}
            {left && <Badge tone="yellow" title="Saved items are dropped after 7 days if the line is not crossed">{left}</Badge>}
            <span className="font-mono text-sm text-white ml-auto">{fmtPrice(price)}</span>
          </div>
          {variant === 'watch' && scout.trigger && (
            <p className="text-sm text-white break-words">Waiting for {scout.trigger}</p>
          )}
          {scout.reason && (
            <p className={`break-words leading-relaxed ${variant === 'open' ? 'text-sm text-white' : 'text-xs text-[#8b949e]'}`}>{scout.reason}</p>
          )}
          <IndicatorChips ind={scout.indicators} />
        </div>
        <ChartToggle open={open} onClick={onToggle} sym={sym} />
      </div>
      {open && (
        <div className="mt-3 pt-3 border-t border-[#30363d]">
          <LinesAndChart sym={sym} lines={scout.lines} />
        </div>
      )}
    </li>
  );
}

function Group({ title, count, hint, children }) {
  return (
    <section>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-2">
        <SectionLabel>{title}</SectionLabel>
        <span className="text-[10px] font-mono text-[#8b949e]">{count}</span>
        {hint && <span className="text-[11px] text-[#484f58]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }) => (
  <p className="text-xs text-[#8b949e] rounded-lg border border-dashed border-[#30363d] px-3 py-2.5">{children}</p>
);

function ChartRoom({ scouts }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(null);
  const sorted = [...scouts].sort(bySym);
  if (!sorted.length) return null;

  const fallback = sorted.some((s) => s.sym === 'BTC') ? 'BTC' : sorted[0].sym;
  const sym = sorted.some((s) => s.sym === picked) ? picked : fallback;
  const scout = sorted.find((s) => s.sym === sym);
  const verdict = VERDICTS[scout.verdict] ?? VERDICTS.PASS;

  return (
    <section className="border-t border-[#30363d] pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <SectionLabel>Chart room</SectionLabel>
          <p className="text-xs text-[#8b949e] mt-1 leading-relaxed">See the lines the Scout drew on any coin or stock, including on days with no trade.</p>
        </div>
        <button type="button" className={BTN} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Close chart room' : 'Open chart room'}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="desk-chart-room-coin" className="text-xs text-[#8b949e]">Symbol</label>
            <select
              id="desk-chart-room-coin"
              value={sym}
              onChange={(e) => setPicked(e.target.value)}
              className="bg-[#21262d] border border-[#30363d] rounded-md px-2 py-1.5 text-xs text-white max-w-full focus:outline-none focus:border-[#58a6ff]"
            >
              {sorted.map((s) => {
                const name = coinMeta(s.sym).name;
                return <option key={s.sym} value={s.sym}>{name !== s.sym ? `${s.sym} — ${name}` : s.sym}</option>;
              })}
            </select>
            <Badge tone={verdict.tone}>{verdict.label}</Badge>
            {scout.held && <Badge tone="blue">Holding</Badge>}
          </div>
          <div className="space-y-1">
            {scout.verdict === 'WATCH' && scout.trigger && <p className="text-sm text-white break-words">Waiting for {scout.trigger}</p>}
            {scout.reason && <p className="text-xs text-[#8b949e] break-words leading-relaxed">{scout.reason}</p>}
          </div>
          <IndicatorChips ind={scout.indicators} />
          <LinesAndChart key={sym} sym={sym} lines={scout.lines} />
        </div>
      )}
    </section>
  );
}

export default function ScoutBoard() {
  const { state, prices } = useDesk();
  const [expanded, setExpanded] = useState(null); // 'group:SYM' — one row at a time
  const [showPassed, setShowPassed] = useState(false);
  const [picked, setPicked] = useState(() => recallTab('scout'));
  const last = state.last;
  const groups = last?.groups ?? [];

  if (!last || !groups.length) {
    return (
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-white">Agent 2 · Scout</h2>
        <p className="text-xs text-[#8b949e] mt-2">The Scout is still taking its first look at the charts. Results appear here once the first run finishes.</p>
      </Card>
    );
  }

  const counts = Object.fromEntries(groups.map((g) => [g.id,
    (g.scouts ?? []).filter((x) => x.verdict === 'OPEN').length + Object.keys(state.watch?.[g.id] ?? {}).length]));
  const firstBusy = groups.find((g) => counts[g.id] > 0)?.id;
  const active = groups.some((g) => g.id === picked) ? picked : (firstBusy ?? groups[0].id);
  const group = groups.find((g) => g.id === active);
  const isStock = group.kind === 'stock';
  const noun = isStock ? 'stock' : 'coin';
  const scouts = group.scouts ?? [];
  const openNow = scouts.filter((s) => s.verdict === 'OPEN').sort(bySym);
  const passed = scouts.filter((s) => s.verdict === 'PASS').sort(bySym);
  const saved = Object.values(state.watch?.[active] ?? {}).filter(Boolean).sort((a, b) => (a.expires ?? Infinity) - (b.expires ?? Infinity) || bySym(a, b));
  const choose = (id) => { setPicked(id); rememberTab('scout', id); setExpanded(null); setShowPassed(false); };

  const priceOf = (s) => prices?.[s.sym] ?? s.price;
  // Hiding the passed list also closes any chart that was open inside it.
  const togglePassed = () => {
    if (showPassed) setExpanded((cur) => (cur?.startsWith('pass:') ? null : cur));
    setShowPassed(!showPassed);
  };
  const rows = (list, variant) => (
    <ul className="space-y-2">
      {list.map((s) => {
        const key = `${variant}:${s.sym}`;
        return (
          <ScoutRow
            key={key}
            scout={s}
            variant={variant}
            price={priceOf(s)}
            open={expanded === key}
            onToggle={() => setExpanded((cur) => (cur === key ? null : key))}
          />
        );
      })}
    </ul>
  );

  return (
    <Card className="p-4 space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-white">Agent 2 · Scout</h2>
          <Badge tone={openNow.length ? 'green' : 'grey'}>{openNow.length} open</Badge>
          <Badge tone={saved.length ? 'yellow' : 'grey'}>{saved.length} saved</Badge>
          <span className="text-[11px] text-[#484f58] ml-auto">{scouts.length} chart{scouts.length === 1 ? '' : 's'} checked</span>
        </div>
        <p className="text-xs text-[#8b949e] mt-1.5 leading-relaxed">{EXPLAIN}</p>
      </div>

      <SectorTabs groups={groups} active={active} counts={counts} tone={Object.fromEntries(groups.map((g) => [g.id, groupTone(g)]))} label="Scout by sector" onChange={choose} />

      {group.status !== 'ok' ? (
        <div className="rounded-lg border border-[#30363d] bg-[#1c2128] p-3">
          <p className="text-xs text-[#8b949e] leading-relaxed">{group.statusText || 'Waiting for data.'}</p>
          {group.status === 'no-key' && (
            <button type="button" className={`${BTN} mt-2`} onClick={() => { window.location.hash = '#/paper?settings=stocks'; }}>Add Twelve Data key</button>
          )}
        </div>
      ) : (<>
      {isStock && <p className="text-[11px] text-[#484f58] -mt-2">Measured against the S&amp;P 500 and {group.benchmark}. Only leaders in an uptrend near their 52-week high qualify.</p>}

      <Group title="Open now" count={openNow.length} hint="Handed to the Analyst">
        {openNow.length ? rows(openNow, 'open') : <Empty>Nothing in {group.label} has closed through its line today.</Empty>}
      </Group>

      <Group title="Saved for later" count={saved.length} hint="Could trigger within 7 days">
        {saved.length ? rows(saved, 'watch') : <Empty>No {noun} is close enough to its line to be worth watching.</Empty>}
      </Group>

      <Group title="Passed" count={passed.length}>
        {passed.length === 0 ? <Empty>No {noun} was passed over on this run.</Empty> : (
          <>
            <button type="button" className={BTN} aria-expanded={showPassed} onClick={togglePassed}>
              {showPassed ? `Hide ${passed.length} passed` : `Show ${passed.length} passed`}
            </button>
            {showPassed && <div className="mt-2">{rows(passed, 'pass')}</div>}
          </>
        )}
      </Group>

      <ChartRoom key={active} scouts={scouts} />
      </>)}
    </Card>
  );
}

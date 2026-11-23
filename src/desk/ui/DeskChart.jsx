import { useEffect, useMemo, useRef, useState } from 'react';
import CandleChart from '../../components/CandleChart';
import { useDesk } from '../DeskProvider';
import { readChart, closedOnly } from '../chart/read';
import { BTN } from './atoms';

// The chart with the lines the agents draw. It only reads fields off the chart
// "read" and the plan / position it is given — it makes no decisions.

const DAY_MS = 86_400_000;
const H4_MS = 14_400_000;
const MAX_ZONES = 4;

const C = {
  range: '#f0883e',
  support: '#3fb950',
  resistance: '#f85149',
  supportLine: '#3fb950b3',
  resistanceLine: '#f85149b3',
  trend: '#58a6ff',
  broken: '#484f58',
  entry: '#facc15',
  stop: '#f85149',
  exit: '#bc8cff',
};

const isPrice = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

// Up to four zones: of the handful nearest the price, the strongest.
function pickZones(levels, price) {
  if (!Array.isArray(levels) || !isPrice(price)) return [];
  return levels
    .filter((z) => z && isPrice(z.price))
    .sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))
    .slice(0, MAX_ZONES + 2)
    .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))
    .slice(0, MAX_ZONES)
    .map((z) => {
      const above = z.price > price;
      return {
        price: z.price,
        color: above ? C.resistanceLine : C.supportLine,
        style: 'dotted',
        width: 1,
        title: `${above ? 'R' : 'S'} ×${z.touches}`,
        kind: above ? 'resistance' : 'support',
      };
    });
}

// A trendline from its first anchor through to the newest bar on the chart.
// Sampled at every bar because the line is straight in % terms, not in dollars.
function trendSegment(line, win, shown) {
  if (!line || !line.a || typeof line.valueAt !== 'function' || !Array.isArray(win) || win.length < 2) return null;
  const lastIdx = win.length - 1;
  const from = Math.max(0, line.a.i);
  const points = [];
  for (let i = from; i <= lastIdx; i++) points.push({ time: win[i].time, value: line.valueAt(i) });
  // Carry the line across any bar that is still forming.
  let extra = 0;
  for (const c of shown) {
    if (c.time > win[lastIdx].time) points.push({ time: c.time, value: line.valueAt(lastIdx + ++extra) });
  }
  if (points.length < 2) return null;
  const broken = line.brokenAt != null;
  return {
    points,
    color: broken ? C.broken : C.trend,
    style: broken ? 'dashed' : 'solid',
    width: broken ? 1 : 2,
    broken,
  };
}

function buildOverlays({ frame, read, shown, plan, position }) {
  const priceLines = [];
  const segments = [];
  const legend = [];
  const price = shown.length ? shown[shown.length - 1].close : null;

  if (read) {
    const d = read.d1;
    let hasRange = false;
    if (isPrice(d.rangeHigh)) { priceLines.push({ price: d.rangeHigh, color: C.range, style: 'dashed', width: 1, title: '20-day high' }); hasRange = true; }
    if (isPrice(d.rangeLow)) { priceLines.push({ price: d.rangeLow, color: C.range, style: 'dashed', width: 1, title: '20-day low' }); hasRange = true; }
    if (hasRange) legend.push({ label: '20-day range (breakout lines)', color: C.range, style: 'dashed' });

    const src = frame === '4H' ? read.h4 : d;
    if (src) {
      const zones = pickZones(src.levels, price);
      for (const z of zones) priceLines.push({ price: z.price, color: z.color, style: z.style, width: z.width, title: z.title });
      if (zones.some((z) => z.kind === 'support')) legend.push({ label: 'Support zone (×N = times tested)', color: C.support, style: 'dotted' });
      if (zones.some((z) => z.kind === 'resistance')) legend.push({ label: 'Resistance zone (×N = times tested)', color: C.resistance, style: 'dotted' });

      const trends = [trendSegment(src.support, src.window, shown), trendSegment(src.resistance, src.window, shown)].filter(Boolean);
      for (const t of trends) segments.push({ points: t.points, color: t.color, style: t.style, width: t.width });
      if (trends.some((t) => !t.broken)) legend.push({ label: 'Trendline', color: C.trend, style: 'solid' });
      if (trends.some((t) => t.broken)) legend.push({ label: 'Broken trendline', color: C.broken, style: 'dashed' });
    }
  }

  // An open position wins over a plan: it is what is actually on the books.
  const entry = position ? position.entry : plan?.entry;
  const stop = position ? position.stop : plan?.stop;
  const exit = position ? position.meta?.exitLevel : plan?.exitLevel;
  if (isPrice(entry)) {
    priceLines.push({ price: entry, color: C.entry, style: 'solid', width: 1, title: 'Entry' });
    legend.push({ label: 'Entry', color: C.entry, style: 'solid' });
  }
  if (isPrice(stop)) {
    priceLines.push({ price: stop, color: C.stop, style: 'solid', width: 1, title: 'Stop' });
    legend.push({ label: 'Stop', color: C.stop, style: 'solid' });
  }
  if (isPrice(exit)) {
    priceLines.push({ price: exit, color: C.exit, style: 'dashed', width: 1, title: 'Trail exit' });
    legend.push({ label: 'Trailing exit', color: C.exit, style: 'dashed' });
  }

  return { priceLines, segments, legend };
}

function FrameToggle({ value, onChange, h4Ready }) {
  return (
    <div className="inline-flex items-center rounded-md border border-[#30363d] bg-[#0d1117] p-0.5" role="group" aria-label="Chart timeframe">
      {['1D', '4H'].map((f) => {
        const disabled = f === '4H' && !h4Ready;
        const active = value === f;
        return (
          <button
            key={f}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            title={disabled ? '4-hour candles are not available for this coin right now' : f === '1D' ? 'Daily candles' : '4-hour candles'}
            onClick={() => onChange(f)}
            className={`px-2.5 py-1 rounded text-[11px] font-mono font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              active ? 'bg-[#58a6ff] text-[#0d1117]' : 'text-[#8b949e] enabled:hover:text-white'
            }`}
          >
            {f}
          </button>
        );
      })}
    </div>
  );
}

function Legend({ items }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#8b949e]">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="inline-block w-4 flex-shrink-0" style={{ borderTop: `2px ${it.style} ${it.color}` }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export default function DeskChart({ sym, plan, position, height = 360, defaultFrame = '1D' }) {
  const { actions, status } = useDesk();
  const [frame, setFrame] = useState(defaultFrame === '4H' ? '4H' : '1D');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null); // { key, sym, raw, read, error }

  // loadChart gets a new identity whenever the desk state changes; keep the
  // latest one in a ref so that alone never triggers a reload.
  const loadRef = useRef(actions.loadChart);
  useEffect(() => { loadRef.current = actions.loadChart; });

  // Reload when the coin changes, on Retry, and after each desk run (new candles).
  const key = `${sym}|${attempt}|${status.lastRun ?? 0}`;

  useEffect(() => {
    if (!sym) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => loadRef.current(sym))
      .then((raw) => {
        if (!live) return;
        const d1Raw = Array.isArray(raw?.d1) ? raw.d1 : [];
        const h4Raw = Array.isArray(raw?.h4) && raw.h4.length ? raw.h4 : null;
        if (!d1Raw.length) throw new Error('no candles');
        // Lines are drawn from closed candles only; the chart shows the forming bar too.
        const now = Date.now();
        let read;
        try {
          read = readChart(closedOnly(d1Raw, DAY_MS, now), h4Raw ? closedOnly(h4Raw, H4_MS, now) : null);
        } catch { read = null; } // candles still draw without lines
        setResult({ key, sym, raw: { d1: d1Raw, h4: h4Raw }, read, error: false });
      })
      .catch(() => {
        if (!live) return;
        // A failed background refresh keeps the chart that is already showing.
        setResult((prev) => (prev && prev.sym === sym && prev.raw ? prev : { key, sym, raw: null, read: null, error: true }));
      });
    return () => { live = false; };
  }, [sym, key]);

  const current = result && result.sym === sym ? result : null;
  const raw = current?.raw ?? null;
  const read = current?.read ?? null;
  const failed = !raw && !!current?.error && current.key === key;
  const loading = !raw && !failed;

  const h4Ready = !!raw?.h4;
  const activeFrame = frame === '4H' && h4Ready ? '4H' : '1D';
  const shown = useMemo(() => {
    if (!raw) return [];
    return activeFrame === '4H' ? raw.h4 : raw.d1;
  }, [raw, activeFrame]);

  const { priceLines, segments, legend } = useMemo(
    () => buildOverlays({ frame: activeFrame, read, shown, plan, position }),
    [activeFrame, read, shown, plan, position],
  );

  const caption = activeFrame === '4H'
    ? '4-hour candles. Zones and trendlines are from the 4-hour chart; the 20-day range is from the daily chart.'
    : 'Daily candles. Lines are drawn from closed days; the last candle is still forming.';

  return (
    <div className="w-full min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FrameToggle value={activeFrame} onChange={setFrame} h4Ready={h4Ready} />
        {raw && <span className="text-[10px] text-[#484f58] min-w-0">{caption}</span>}
      </div>

      <div className="rounded-lg border border-[#30363d] bg-[#0d1117] overflow-hidden">
        {raw ? (
          <CandleChart candles={shown} priceLines={priceLines} segments={segments} height={height} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 px-4 text-center" style={{ height }}>
            {loading && <span className="w-5 h-5 border-2 border-[#30363d] border-t-[#58a6ff] rounded-full animate-spin" role="status" aria-label="Loading chart" />}
            {failed && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="text-xs text-red-400">Could not load the {sym} chart.</span>
                <button type="button" className={BTN} onClick={() => setAttempt((n) => n + 1)}>Retry</button>
              </div>
            )}
          </div>
        )}
      </div>

      {raw && !read && (
        <div className="text-[10px] text-[#484f58]">Not enough price history to draw lines for {sym} yet — candles only.</div>
      )}
      {raw && read && activeFrame === '4H' && !read.h4 && (
        <div className="text-[10px] text-[#484f58]">Not enough 4-hour history for zones and trendlines on this frame.</div>
      )}
      <Legend items={legend} />
    </div>
  );
}

import { useEffect } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, CartesianGrid,
  XAxis, YAxis, Tooltip,
} from 'recharts';
import { calcBollingerBands } from '../utils/indicators';

const INTERVAL_DATE_FMT = {
  '1h': (t) => new Date(t).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', hour12: true }),
  '4h': (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true }),
  '1d': (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  '1w': (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
};

function buildChartData(candles, interval) {
  if (!candles || candles.length < 20) return [];
  const fmt = INTERVAL_DATE_FMT[interval] ?? INTERVAL_DATE_FMT['1d'];
  const bbs = calcBollingerBands(candles, 20, 2);
  const display = candles.slice(-120);
  return display.map((c, i) => {
    const bbIdx = i + candles.length - display.length - 19;
    const bb = bbIdx >= 0 && bbIdx < bbs.length ? bbs[bbIdx] : null;
    return {
      date:     fmt(c.time),
      close:    parseFloat(c.close.toFixed(6)),
      bbUpper:  bb ? parseFloat(bb.upper.toFixed(6)) : undefined,
      bbMiddle: bb ? parseFloat(bb.middle.toFixed(6)) : undefined,
      bbLower:  bb ? parseFloat(bb.lower.toFixed(6)) : undefined,
    };
  });
}

function fmtPrice(val) {
  if (val == null) return '';
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`;
  if (val >= 1)    return `$${val.toFixed(2)}`;
  return `$${val.toFixed(4)}`;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 text-xs shadow-lg">
      <div className="text-[#8b949e] mb-2 text-sm">{label}</div>
      {payload.map((p) =>
        p.value != null && (
          <div key={p.dataKey} className="flex justify-between gap-6 py-0.5">
            <span style={{ color: p.color }}>{p.name}</span>
            <span className="font-mono text-white text-sm">{fmtPrice(p.value)}</span>
          </div>
        )
      )}
    </div>
  );
};

export default function FullscreenChart({ candles, interval = '1d', color = '#58a6ff', buyPrice, coinName, onClose }) {
  const data = buildChartData(candles, interval);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const xInterval = Math.max(1, Math.floor(data.length / 8));

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0d1117]/98 flex flex-col"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363d]">
        <div>
          <span className="font-semibold text-white">{coinName}</span>
          <span className="ml-2 text-xs text-[#484f58] uppercase">{interval} · Bollinger Bands</span>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-md flex items-center justify-center text-[#8b949e] hover:text-white hover:bg-[#21262d] transition-colors text-lg leading-none"
          aria-label="Close fullscreen chart"
        >
          ✕
        </button>
      </div>

      {/* Chart fills remaining height */}
      <div className="flex-1 px-2 py-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 8" stroke="#21262d" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: '#484f58' }}
              interval={xInterval}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#8b949e' }}
              tickFormatter={fmtPrice}
              domain={['auto', 'auto']}
              axisLine={false}
              tickLine={false}
              width={62}
              orientation="right"
            />
            <Tooltip content={<CustomTooltip />} />
            <Line name="BB Upper" type="monotone" dataKey="bbUpper"  stroke="#30363d" strokeWidth={1.5} dot={false} strokeDasharray="3 3" connectNulls />
            <Line name="BB Mid"   type="monotone" dataKey="bbMiddle" stroke="#21262d" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls />
            <Line name="BB Lower" type="monotone" dataKey="bbLower"  stroke="#30363d" strokeWidth={1.5} dot={false} strokeDasharray="3 3" connectNulls />
            <Line name="Price"    type="monotone" dataKey="close"    stroke={color}   strokeWidth={2.5} dot={false} connectNulls activeDot={{ r: 4, fill: color }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="text-center pb-3 text-[10px] text-[#30363d]">Tap outside the chart or press Esc to close</div>
    </div>
  );
}

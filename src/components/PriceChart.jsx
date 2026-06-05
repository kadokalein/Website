import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, ComposedChart, Line, CartesianGrid,
  XAxis, YAxis, Tooltip, ReferenceLine,
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
  if (val >= 1000) return `$${(val / 1000).toFixed(0)}k`;
  if (val >= 1)    return `$${val.toFixed(2)}`;
  return `$${val.toFixed(4)}`;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-2.5 text-xs shadow-lg">
      <div className="text-[#8b949e] mb-1.5">{label}</div>
      {payload.map((p) =>
        p.value != null && (
          <div key={p.dataKey} className="flex justify-between gap-4">
            <span style={{ color: p.color }}>{p.name}</span>
            <span className="font-mono text-white">{fmtPrice(p.value)}</span>
          </div>
        )
      )}
    </div>
  );
};

export default function PriceChart({ candles, interval = '1d', color = '#58a6ff', buyPrice, coinSymbol, timeframe }) {
  const navigate = useNavigate();
  const data = buildChartData(candles, interval);

  if (data.length === 0) {
    return <div className="flex items-center justify-center h-[240px] text-[#484f58] text-sm">Loading chart…</div>;
  }

  const xInterval = Math.max(1, Math.floor(data.length / 6));

  const handleClick = () => {
    if (coinSymbol) navigate(`/coin/${coinSymbol}/chart?tf=${timeframe || '1D'}`);
  };

  return (
    <div
      className="relative cursor-pointer group"
      onClick={handleClick}
      title="Tap to open full chart"
    >
      {/* Expand hint */}
      <div className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 sm:group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="bg-[#161b22]/90 border border-[#30363d] rounded px-1.5 py-0.5 text-[9px] text-[#8b949e]">
          ⤢ full chart
        </div>
      </div>
      {/* Always-visible tap hint on mobile */}
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-10 sm:hidden pointer-events-none">
        <div className="bg-[#161b22]/80 border border-[#30363d] rounded px-2 py-0.5 text-[9px] text-[#484f58]">
          tap for full chart
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 8" stroke="#21262d" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#484f58' }} interval={xInterval} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: '#484f58' }} tickFormatter={fmtPrice} domain={['auto', 'auto']} axisLine={false} tickLine={false} width={48} />
          <Tooltip content={<CustomTooltip />} />
          <Line name="BB Upper" type="monotone" dataKey="bbUpper"  stroke="#30363d" strokeWidth={1} dot={false} strokeDasharray="3 3" connectNulls />
          <Line name="BB Mid"   type="monotone" dataKey="bbMiddle" stroke="#21262d" strokeWidth={1} dot={false} strokeDasharray="5 3" connectNulls />
          <Line name="BB Lower" type="monotone" dataKey="bbLower"  stroke="#30363d" strokeWidth={1} dot={false} strokeDasharray="3 3" connectNulls />
          <Line name="Price"    type="monotone" dataKey="close"    stroke={color}   strokeWidth={2} dot={false} connectNulls activeDot={{ r: 3, fill: color }} />
          {buyPrice != null && (
            <ReferenceLine y={buyPrice} stroke="#facc15" strokeDasharray="4 4" strokeWidth={1.5}
              label={{ value: 'Entry', fill: '#facc15', fontSize: 9, position: 'insideTopLeft' }} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

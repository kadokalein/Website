import { computeRunScore } from '../utils/scoring';

const SIGNAL_STYLE = {
  'BUY TRIGGERED': { bg: 'bg-green-900/25 border-green-500/50', badge: 'bg-green-500/20 text-green-300', dot: 'bg-green-400 animate-pulse' },
  'WATCH':         { bg: 'bg-yellow-900/15 border-yellow-500/30', badge: 'bg-yellow-500/15 text-yellow-400', dot: 'bg-yellow-400' },
  'LOW QUALITY':   { bg: 'bg-[#1c2128] border-[#30363d]', badge: 'bg-[#30363d] text-[#484f58]', dot: 'bg-[#484f58]' },
  'NO SIGNAL':     { bg: 'bg-[#1c2128] border-[#30363d]', badge: 'bg-[#30363d] text-[#484f58]', dot: 'bg-[#30363d]' },
};

function Bar({ score, max, label }) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  const full = pct === 100;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[#484f58] w-8 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-[#30363d] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${full ? 'bg-green-400' : score > 0 ? 'bg-[#58a6ff]' : 'bg-[#30363d]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[10px] font-mono w-9 text-right flex-shrink-0 ${full ? 'text-green-400' : score > 0 ? 'text-white' : 'text-[#484f58]'}`}>
        {score}/{max}
      </span>
    </div>
  );
}

export default function RunSignal({ analysis }) {
  const run = computeRunScore(analysis);
  if (!run) return null;

  const style = SIGNAL_STYLE[run.signal] ?? SIGNAL_STYLE['NO SIGNAL'];

  return (
    <div className={`rounded-lg p-3 border ${style.bg}`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${style.badge}`}>
            {run.signal}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#484f58]">{run.stateLabel}</span>
          <span className="text-xs font-mono font-bold text-white">{run.score}%</span>
        </div>
      </div>

      {/* Trigger reason */}
      {run.triggerReason && (
        <div className="text-[10px] text-green-400 mb-2 leading-tight">
          ↑ {run.triggerReason}
        </div>
      )}

      {/* Indicator bars */}
      <div className="space-y-1.5">
        {Object.values(run.breakdown).map(b => (
          <Bar key={b.label} score={b.score} max={b.max} label={b.label} />
        ))}
      </div>
    </div>
  );
}

// Small shared building blocks so every desk screen looks the same.
import { coinMeta } from './format';

const TONES = {
  green: 'bg-green-500/15 text-green-300 border-green-500/30',
  red: 'bg-red-500/15 text-red-400 border-red-500/30',
  yellow: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/25',
  blue: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  orange: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  grey: 'bg-[#21262d] text-[#8b949e] border-[#30363d]',
};

export function Badge({ tone = 'grey', children, title }) {
  return <span title={title} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${TONES[tone] ?? TONES.grey}`}>{children}</span>;
}

export function Card({ children, className = '' }) {
  return <div className={`rounded-xl border border-[#30363d] bg-[#161b22] ${className}`}>{children}</div>;
}

export function SectionLabel({ children, className = '' }) {
  return <div className={`text-[10px] font-semibold text-[#484f58] uppercase tracking-widest ${className}`}>{children}</div>;
}

export function CoinChip({ sym, size = 'md' }) {
  const c = coinMeta(sym);
  const box = size === 'sm' ? 'w-6 h-6 text-[9px]' : 'w-8 h-8 text-[10px]';
  return (
    <span className={`${box} rounded-full inline-flex items-center justify-center font-bold flex-shrink-0`}
      style={{ backgroundColor: `${c.color}25`, color: c.color }}>
      {sym.slice(0, 4)}
    </span>
  );
}

export function Stat({ label, value, sub, tone = 'text-white' }) {
  return (
    <Card className="p-3">
      <SectionLabel className="mb-1">{label}</SectionLabel>
      <div className={`text-lg font-mono font-bold ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-[#8b949e] mt-0.5">{sub}</div>}
    </Card>
  );
}

export const BTN = 'px-3 py-1.5 rounded-md text-xs bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white disabled:opacity-40 transition-colors';

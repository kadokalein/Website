const CONFIG = {
  low:    { label: '🟢 Low',    classes: 'bg-green-900/30 text-green-400 border-green-500/40' },
  medium: { label: '🟡 Medium', classes: 'bg-yellow-900/30 text-yellow-400 border-yellow-500/40' },
  high:   { label: '🔴 High',   classes: 'bg-red-900/30 text-red-400 border-red-500/40' },
};

export default function VolatilityBadge({ level }) {
  const { label, classes } = CONFIG[level] ?? CONFIG.medium;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${classes}`}>
      {label}
    </span>
  );
}

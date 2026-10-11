const CONDITION_LABELS = {
  atrSupport:  'ATR Support',
  bbLower:     'BB Lower Band',
  rsiOversold: 'RSI Oversold',
  macdCross:   'MACD Crossover',
  volumeHigh:  'Volume Surge',
};

export default function EntrySignal({ conditions, activeConditions, entrySignal }) {
  return (
    <div
      className={`rounded-lg p-3 border transition-colors duration-300 ${
        entrySignal
          ? 'bg-green-900/20 border-green-500/40'
          : 'bg-[#1c2128] border-[#30363d]'
      }`}
    >
      {/* Status row */}
      <div className="flex items-center justify-between mb-2.5">
        <span className={`text-sm font-medium ${entrySignal ? 'text-green-400' : 'text-[#8b949e]'}`}>
          {entrySignal ? '✅ Entry Conditions Met' : '⏳ Waiting for Alignment'}
        </span>
        <span
          className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${
            entrySignal
              ? 'bg-green-500/20 text-green-400'
              : activeConditions >= 2
              ? 'bg-yellow-500/20 text-yellow-400'
              : 'bg-[#30363d] text-[#8b949e]'
          }`}
        >
          {activeConditions}/5
        </span>
      </div>

      {/* Condition pills */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {Object.entries(CONDITION_LABELS).map(([key, label]) => {
          const active = conditions[key];
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  active ? 'bg-green-400' : 'bg-[#30363d]'
                }`}
              />
              <span className={`text-xs ${active ? 'text-green-400' : 'text-[#484f58]'}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

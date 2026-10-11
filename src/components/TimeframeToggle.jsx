const TIMEFRAMES = ['1H', '4H', '1D', '1W'];

export default function TimeframeToggle({ value, onChange }) {
  return (
    <div className="flex bg-[#161b22] border border-[#30363d] rounded-lg p-1 gap-1">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          onClick={() => onChange(tf)}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-150 ${
            value === tf
              ? 'bg-[#58a6ff] text-[#0d1117] shadow'
              : 'text-[#8b949e] hover:text-white hover:bg-[#21262d]'
          }`}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}

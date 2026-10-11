// label: left-hand descriptor
// value: main numeric/text value (right-aligned)
// subtext: small annotation beside value
// highlight: Tailwind text-color class for the value
export default function MetricRow({ label, value, subtext, highlight = 'text-white' }) {
  return (
    <div className="flex justify-between items-center py-[5px]">
      <span className="text-[#8b949e] text-sm">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={`text-sm font-mono ${highlight}`}>{value}</span>
        {subtext && (
          <span className="text-xs text-[#8b949e]">{subtext}</span>
        )}
      </div>
    </div>
  );
}

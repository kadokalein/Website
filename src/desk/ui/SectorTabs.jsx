// A row of sector tabs (Crypto, Pharma & Biotech, AI, …) shared by the desk sections.
import { useRef } from 'react';

const DOT = { green: 'bg-green-400', yellow: 'bg-yellow-400', red: 'bg-red-400', grey: 'bg-[#484f58]' };

// groups: [{ id, label }]; active: id; onChange(id); counts?: { id: number }; tone?: { id: 'green'|'yellow'|'red'|'grey' }
export default function SectorTabs({ groups, active, onChange, counts = {}, tone = {}, label = 'Sectors' }) {
  const refs = useRef({});
  const ids = groups.map((g) => g.id);

  function onKey(e) {
    const i = ids.indexOf(active);
    let next = null;
    if (e.key === 'ArrowRight') next = ids[(i + 1) % ids.length];
    else if (e.key === 'ArrowLeft') next = ids[(i - 1 + ids.length) % ids.length];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  }

  return (
    <div className="-mx-1 px-1 overflow-x-auto" role="tablist" aria-label={label} onKeyDown={onKey}>
      <div className="flex gap-1 min-w-max">
        {groups.map((g) => {
          const on = g.id === active;
          return (
            <button key={g.id} ref={(el) => { refs.current[g.id] = el; }} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
              onClick={() => onChange(g.id)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap border transition-colors flex items-center gap-1.5 ${
                on ? 'bg-[#21262d] text-white border-[#30363d]' : 'text-[#8b949e] border-transparent hover:text-white'}`}>
              {tone[g.id] && <span className={`w-1.5 h-1.5 rounded-full ${DOT[tone[g.id]] ?? DOT.grey}`} />}
              {g.label}
              {counts[g.id] > 0 && <span className="font-mono text-[10px] px-1 rounded bg-[#30363d] text-white">{counts[g.id]}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ADMIN_EMAIL, supabase } from '../lib/supabase';
import { useDesk } from '../desk/DeskProvider';

const LINKS = [
  { to: '/', label: 'Scanner', end: true },
  { to: '/desk', label: 'Trading Desk' },
  { to: '/paper', label: 'Portfolio' },
  { to: '/watchlist', label: 'Watchlist' },
  { to: '/live', label: 'Live' },
];

const TONES = {
  red: 'bg-red-500/15 text-red-400 border-red-500/30',
  blue: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  green: 'bg-green-500/15 text-green-300 border-green-500/30',
  yellow: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/25',
  grey: 'bg-[#21262d] text-[#8b949e] border-[#30363d]',
};

// The one navigation bar every page shares.
//   badge   — { text, tone } shown beside the links (e.g. SIMULATED, REAL MONEY)
//   actions — page-specific buttons, shown on the right before the account controls
//   subRow  — optional second row (e.g. a timeframe toggle)
export default function AppNav({ badge = null, actions = null, subRow = null }) {
  const { user } = useAuth();
  const { status } = useDesk();
  const isAdmin = user?.email === ADMIN_EMAIL;
  const displayName = isAdmin ? 'Administrator' : (user?.user_metadata?.name || user?.email?.split('@')[0] || '');

  return (
    <header className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117]/95 backdrop-blur px-4 sm:px-6 py-3">
      <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3">
        <div className="flex items-center justify-between gap-3 lg:flex-1 lg:justify-start min-w-0">
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
            <span className="font-semibold text-white text-sm sm:text-base truncate">Promethea Programs</span>
          </Link>
          <div className="flex items-center gap-2 lg:hidden">{actions}</div>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto lg:justify-center -mx-1 px-1" aria-label="Main">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}
              className={({ isActive }) => `px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap border transition-colors ${
                isActive ? 'bg-[#21262d] text-white border-[#30363d]' : 'text-[#8b949e] border-transparent hover:text-white'}`}>
              {l.label}
              {l.to === '/desk' && status.running && (
                <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse align-middle" title="The desk is scanning" />
              )}
            </NavLink>
          ))}
          {badge && (
            <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${TONES[badge.tone] ?? TONES.grey}`}>{badge.text}</span>
          )}
        </nav>

        <div className="flex items-center gap-2 lg:flex-1 lg:justify-end">
          <div className="hidden lg:flex items-center gap-2">{actions}</div>
          {user ? (
            <>
              <span className={`text-sm font-semibold truncate max-w-[10rem] ${isAdmin ? 'text-[#bc8cff]' : 'text-white'}`}>{displayName}</span>
              {isAdmin && (
                <Link to="/admin" className="px-3 py-1.5 rounded-lg bg-[#6e40c9] hover:bg-[#7d4fd4] text-white text-xs font-medium transition-colors">Admin</Link>
              )}
              <button onClick={() => supabase?.auth.signOut()}
                className="px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-white text-xs font-medium transition-colors">
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/subscribe?mode=signin" className="px-3 py-1.5 rounded-lg bg-[#1f6feb] hover:bg-[#388bfd] text-white text-xs font-medium transition-colors">Login</Link>
              <Link to="/subscribe" className="px-3 py-1.5 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold transition-colors">Subscribe</Link>
            </>
          )}
        </div>
      </div>
      {subRow && <div className="mt-2 flex items-center gap-2 flex-wrap lg:justify-center">{subRow}</div>}
    </header>
  );
}

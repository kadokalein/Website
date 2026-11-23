import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWatchlist } from '../context/WatchlistContext';
import { findCoin } from '../constants';
import CoinCard from '../components/CoinCard';
import TimeframeToggle from '../components/TimeframeToggle';
import AppNav from '../components/AppNav';

export default function Watchlist() {
  const { user, loading: authLoading } = useAuth();
  const { symbols, loading: listLoading } = useWatchlist();
  const [timeframe, setTimeframe] = useState('4H');

  // Still determining auth state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0d1117] text-white">
        <AppNav />
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-[#30363d] border-t-[#58a6ff] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // Not logged in — show login gate
  if (!user) {
    return (
      <div className="min-h-screen bg-[#0d1117] text-white">
        <AppNav />
        <main className="max-w-md mx-auto px-4 py-24 text-center">
          <div className="text-5xl mb-6">★</div>
          <h1 className="text-2xl font-bold text-white mb-3">Your Watchlist</h1>
          <p className="text-[#8b949e] text-sm mb-8">
            Sign in to save coins to your personal watchlist and access them from any device.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/subscribe?mode=signin"
              className="px-6 py-3 rounded-lg bg-[#1f6feb] hover:bg-[#388bfd] text-white font-semibold text-sm transition-colors"
            >
              Sign in
            </Link>
            <Link
              to="/subscribe"
              className="px-6 py-3 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-white font-semibold text-sm transition-colors"
            >
              Create account
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const coins = symbols.map(s => findCoin(s)).filter(Boolean);

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <AppNav subRow={<TimeframeToggle value={timeframe} onChange={setTimeframe} />} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h1 className="text-white font-semibold text-sm flex items-center gap-1.5">
            <span className="text-yellow-300">★</span> Watchlist
          </h1>
          <span className="text-xs text-[#484f58]">{coins.length} coin{coins.length !== 1 ? 's' : ''}</span>
        </div>
        {listLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-[#30363d] bg-[#161b22] min-h-[440px] animate-pulse" />
            ))}
          </div>
        ) : coins.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-5xl mb-5 text-[#30363d]">☆</div>
            <div className="text-white font-semibold mb-2">Your watchlist is empty</div>
            <p className="text-[#8b949e] text-sm mb-6">
              Tap the <span className="text-yellow-300">☆</span> star on any coin card to add it here.
            </p>
            <Link to="/" className="px-5 py-2.5 rounded-lg bg-[#21262d] border border-[#30363d] text-sm text-white hover:bg-[#30363d] transition-colors">
              Browse coins
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {coins.map(coin => (
              <CoinCard key={coin.symbol} symbol={coin.symbol} name={coin.name} color={coin.color} timeframe={timeframe} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

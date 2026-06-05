import { useState } from 'react';
import { Link } from 'react-router-dom';
import { COINS } from '../constants';
import { useAuth } from '../hooks/useAuth';
import { ADMIN_EMAIL, supabase } from '../lib/supabase';
import { useCryptoScanner } from '../hooks/useCryptoScanner';
import CoinCard from '../components/CoinCard';
import TimeframeToggle from '../components/TimeframeToggle';
export default function Dashboard() {
  const [timeframe, setTimeframe] = useState('4H');
  const [mode, setMode] = useState('scanner'); // 'scanner' | 'watchlist'
  const { user } = useAuth();

  const isAdmin = user?.email === ADMIN_EMAIL;
  const displayName = isAdmin
    ? 'Administrator'
    : (user?.user_metadata?.name || user?.email?.split('@')[0] || '');

  const { topCoins, scanning, scanned, total, lastUpdated: scanUpdated, refresh: rescan } =
    useCryptoScanner(timeframe, 6);

  async function handleSignOut() {
    if (supabase) await supabase.auth.signOut();
  }

  const coinsToShow    = mode === 'watchlist' ? COINS : topCoins;
  const buyTriggered   = topCoins.filter(c => c.runScore?.signal === 'BUY TRIGGERED').length;
  const watchCount     = topCoins.filter(c => c.runScore?.signal === 'WATCH').length;

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <header className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117]/95 backdrop-blur px-4 sm:px-6 py-3">
        {/* Row 1: Logo + auth */}
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <img src="/Website/logo.svg" alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
            <span className="font-semibold text-white text-sm sm:text-base truncate">Promethea Programs</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {user ? (
              <>
                <span className="text-sm text-[#8b949e] hidden sm:block">
                  Welcome, <span className={isAdmin ? 'text-[#bc8cff] font-semibold' : 'text-white font-semibold'}>{displayName}</span>!
                </span>
                <span className="text-sm sm:hidden">
                  <span className={isAdmin ? 'text-[#bc8cff] font-semibold' : 'text-white font-semibold'}>{displayName}</span>
                </span>
                {isAdmin && (
                  <Link to="/admin"
                    className="px-3 py-1.5 rounded-lg bg-[#6e40c9] hover:bg-[#7d4fd4] text-white text-xs font-medium transition-colors">
                    Admin
                  </Link>
                )}
                <button onClick={handleSignOut}
                  className="px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-white text-xs font-medium transition-colors">
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link to="/subscribe?mode=signin"
                  className="px-3 py-1.5 rounded-lg bg-[#1f6feb] hover:bg-[#388bfd] text-white text-sm font-medium transition-colors">
                  Login
                </Link>
                <Link to="/subscribe"
                  className="px-3 py-1.5 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-white text-sm font-semibold transition-colors">
                  Subscribe
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Row 2: Timeframe + Bitcoin toggle */}
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <TimeframeToggle value={timeframe} onChange={setTimeframe} />
          <div className="w-px h-5 bg-[#30363d] flex-shrink-0" />
          <button
            onClick={() => setMode(m => m === 'scanner' ? 'watchlist' : 'scanner')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex-shrink-0 ${
              mode === 'watchlist'
                ? 'bg-orange-500 text-white'
                : 'text-orange-400 bg-orange-500/10 border border-orange-500/25 hover:border-orange-400/50'
            }`}
          >
            Bitcoin
          </button>
          <Link
            to="/watchlist"
            className="px-3 py-1.5 rounded-md text-sm font-medium transition-all flex-shrink-0 text-yellow-900 bg-yellow-200/80 hover:bg-yellow-200 border border-yellow-300/40"
          >
            ☆ Watch
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

        {/* Scanner status banner */}
        {mode === 'scanner' && (
          <div className="mb-5 rounded-xl border border-[#30363d] bg-[#161b22] px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white flex items-center gap-2 flex-wrap">
                  {scanning ? (
                    <>
                      <span className="inline-block w-3 h-3 rounded-full border-2 border-orange-400/30 border-t-orange-400 animate-spin flex-shrink-0" />
                      Scanning {total} cryptos… {scanned}/{total}
                    </>
                  ) : topCoins.length > 0 ? (
                    <>
                      <span className="text-orange-400">▲</span>
                      Top {topCoins.length} from {total} coins scanned
                      {buyTriggered > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-green-500/15 text-green-300 text-[10px] font-semibold border border-green-500/30">
                          {buyTriggered} BUY TRIGGERED
                        </span>
                      )}
                      {watchCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 text-[10px] font-semibold border border-yellow-500/25">
                          {watchCount} WATCH
                        </span>
                      )}
                    </>
                  ) : (
                    'Scanning for run setups…'
                  )}
                </div>
                <div className="text-[10px] text-[#484f58] mt-0.5">
                  {scanning
                    ? `Vol 35% · MACD 25% · RSI 20% · BB 10% · ATR 10% — analyzing ${total} coins`
                    : scanUpdated
                      ? `Vol 35% · MACD 25% · RSI 20% · BB 10% · ATR 10% — updated ${scanUpdated.toLocaleTimeString()}`
                      : 'Scored by ATR · RSI · MACD · Bollinger Bands · Volume'}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {scanning ? (
                  <div className="w-20 h-1.5 bg-[#30363d] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-500 rounded-full transition-all duration-300"
                      style={{ width: `${total > 0 ? (scanned / total) * 100 : 0}%` }}
                    />
                  </div>
                ) : (
                  <button
                    onClick={rescan}
                    className="text-[10px] text-[#484f58] hover:text-[#8b949e] transition-colors px-2 py-1 rounded border border-[#30363d] hover:border-[#484f58]">
                    Rescan
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Coin grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {mode === 'scanner' && scanning && topCoins.length === 0 ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-[#30363d] bg-[#161b22] min-h-[440px] animate-pulse" />
            ))
          ) : (
            coinsToShow.map(coin => (
              <CoinCard key={coin.symbol} symbol={coin.symbol} name={coin.name} color={coin.color} timeframe={timeframe} />
            ))
          )}
        </div>

        {/* Guide */}
        <div className="mt-6 rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Dashboard Guide</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-[#8b949e]">
            <div className="space-y-1">
              <div className="font-medium text-[#8b949e] mb-1">Volatility (ATR Percentile)</div>
              <div>🟢 Low — ATR below 20th percentile</div>
              <div>🟡 Medium — ATR 20th–80th percentile</div>
              <div>🔴 High — ATR above 80th percentile</div>
              <div className="pt-1 text-[#484f58]">Confirmed by BB Width &amp; Realized Volatility</div>
            </div>
            <div className="space-y-1">
              <div className="font-medium text-[#8b949e] mb-1">Weighted Score (100 pts)</div>
              <div>🔵 Volume anomaly — 35 pts (≥2× avg = full)</div>
              <div>🔵 MACD momentum shift — 25 pts</div>
              <div>🔵 RSI condition — 20 pts</div>
              <div>🔵 Bollinger Band position — 10 pts</div>
              <div>🔵 ATR compression — 10 pts</div>
            </div>
            <div className="space-y-1">
              <div className="font-medium text-[#8b949e] mb-1">Signal Levels</div>
              <div className="text-green-400">🟢 BUY TRIGGERED — score ≥80 + state change + volume</div>
              <div className="text-yellow-400">🟡 WATCH — score 60–79, volume present</div>
              <div className="text-[#8b949e]">⚪ LOW QUALITY — score 40–59</div>
              <div className="text-[#484f58]">⬛ NO SIGNAL — score &lt;40</div>
              <div className="pt-1 text-orange-400/80">Tap <span className="font-semibold">Bitcoin</span> for BTC · ETH · SOL · XRP · DOGE</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

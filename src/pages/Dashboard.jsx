import { useState } from 'react';
import { Link } from 'react-router-dom';
import { COINS } from '../constants';
import CoinCard from '../components/CoinCard';
import TimeframeToggle from '../components/TimeframeToggle';

export default function Dashboard() {
  const [timeframe, setTimeframe] = useState('1D');

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <header className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117]/95 backdrop-blur px-4 sm:px-6 py-3">
        {/* Row 1: Logo + title + Login/Subscribe always visible */}
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <img src="/Website/logo.svg" alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
            <span className="font-semibold text-white text-sm sm:text-base truncate">Promethea Programs</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link to="/subscribe?mode=signin"
              className="px-3 py-1.5 rounded-lg bg-[#1f6feb] hover:bg-[#388bfd] text-white text-sm font-medium transition-colors">
              Login
            </Link>
            <Link to="/subscribe"
              className="px-3 py-1.5 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-white text-sm font-semibold transition-colors">
              Subscribe
            </Link>
          </div>
        </div>
        {/* Row 2: Timeframe toggle */}
        <div className="max-w-7xl mx-auto">
          <TimeframeToggle value={timeframe} onChange={setTimeframe} />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {COINS.map((coin) => (
            <CoinCard key={coin.symbol} {...coin} timeframe={timeframe} />
          ))}
        </div>

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
              <div className="font-medium text-[#8b949e] mb-1">Entry Signal (≥ 3 of 5)</div>
              <div>① Price at ATR support zone</div>
              <div>② Price at/below BB lower band</div>
              <div>③ RSI &lt; 35 (oversold)</div>
              <div>④ Bullish MACD crossover (last 3 bars)</div>
              <div>⑤ Volume ≥ 1.2× 20-day average</div>
            </div>
            <div className="space-y-1">
              <div className="font-medium text-[#8b949e] mb-1">Entry Zones (limit order targets)</div>
              <div className="text-[#58a6ff]">Conservative = Price − 1.5×ATR</div>
              <div className="text-[#bc8cff]">Aggressive = Price − 2×ATR</div>
              <div className="pt-1 text-[#484f58]">BB Width ⚠ = volatility compression, breakout likely</div>
              <div className="text-[#484f58]">Tap any card to view chart &amp; details</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

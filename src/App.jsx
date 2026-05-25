import { useState } from 'react';
import CoinCard from './components/CoinCard';
import TimeframeToggle from './components/TimeframeToggle';

const COINS = [
  { symbol: 'BTC',  name: 'Bitcoin',  color: '#F7931A' },
  { symbol: 'ETH',  name: 'Ethereum', color: '#627EEA' },
  { symbol: 'SOL',  name: 'Solana',   color: '#9945FF' },
  { symbol: 'XRP',  name: 'XRP',      color: '#00AAE4' },
  { symbol: 'DOGE', name: 'Dogecoin', color: '#C3A634' },
];

export default function App() {
  const [timeframe, setTimeframe] = useState('1D');

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">

      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117]/95 backdrop-blur px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-white tracking-tight">
              Crypto Volatility & Entry Tracker
            </h1>
            <p className="text-xs text-[#8b949e] mt-0.5">
              BTC · ETH · SOL · XRP · DOGE — live data via CryptoCompare, refreshes every 60 s
            </p>
          </div>
          <TimeframeToggle value={timeframe} onChange={setTimeframe} />
        </div>
      </header>

      {/* ── Card grid ── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {COINS.map((coin) => (
            <CoinCard key={coin.symbol} {...coin} timeframe={timeframe} />
          ))}
        </div>

        {/* ── Legend ── */}
        <div className="mt-6 rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Dashboard Guide</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-[#8b949e]">

            <div className="space-y-1">
              <div className="font-medium text-[#8b949e] mb-1">Volatility (ATR Percentile)</div>
              <div>🟢 Low — ATR below 20th percentile</div>
              <div>🟡 Medium — ATR 20th–80th percentile</div>
              <div>🔴 High — ATR above 80th percentile</div>
              <div className="pt-1 text-[#484f58]">
                Confirmed by BB Width &amp; Realized Volatility
              </div>
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
              <div className="pt-1 text-[#484f58]">
                BB Width ⚠ = volatility compression, breakout likely
              </div>
              <div className="text-[#484f58]">Data: CryptoCompare public API</div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}

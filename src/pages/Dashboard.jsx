import { useState } from 'react';
import { Link } from 'react-router-dom';
import { COINS } from '../constants';
import { useCryptoScanner } from '../hooks/useCryptoScanner';
import CoinCard from '../components/CoinCard';
import TimeframeToggle from '../components/TimeframeToggle';
import AppNav from '../components/AppNav';
import { Card, BTN } from '../desk/ui/atoms';

export default function Dashboard() {
  const [timeframe, setTimeframe] = useState('4H');
  const [mode, setMode] = useState('scanner'); // 'scanner' | 'watchlist'
  const { topCoins, scanning, scanned, total, lastUpdated: scanUpdated, refresh: rescan, fetchErrors, lastError } =
    useCryptoScanner(timeframe, 6);

  // If scan completed with 0 results (all API calls failed), fall back to the core 5 coins
  const scanFailed = !scanning && topCoins.length === 0 && scanned > 0;
  const coinsToShow    = mode === 'watchlist' ? COINS : (scanFailed ? COINS : topCoins);
  const buyTriggered   = topCoins.filter(c => c.runScore?.signal === 'BUY TRIGGERED').length;
  const watchCount     = topCoins.filter(c => c.runScore?.signal === 'WATCH').length;

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <AppNav
        subRow={
          <>
            <TimeframeToggle value={timeframe} onChange={setTimeframe} />
            <div className="w-px h-5 bg-[#30363d] flex-shrink-0 hidden sm:block" />
            <button
              onClick={() => setMode(m => m === 'scanner' ? 'watchlist' : 'scanner')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex-shrink-0 ${
                mode === 'watchlist'
                  ? 'bg-orange-500 text-white'
                  : 'text-orange-400 bg-orange-500/10 border border-orange-500/25 hover:border-orange-400/50'
              }`}
            >
              Core 5
            </button>
          </>
        }
      />

      <main className="w-full px-4 sm:px-6 py-6">

        {/* Trading Desk call-out */}
        <Card className="mb-5 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-[#8b949e]">
            The scanner shows which coins look interesting right now. The Trading Desk decides whether any of them is actually worth a trade — and usually the answer is no.
          </p>
          <Link to="/desk" className={`${BTN} self-start sm:self-auto flex-shrink-0 whitespace-nowrap`}>Open Trading Desk</Link>
        </Card>

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
                  ) : scanFailed ? (
                    <span className="text-red-400">
                      Scanner unavailable — showing core coins
                      {fetchErrors > 0 && <span className="text-[#484f58] font-normal"> ({fetchErrors}/{total} failed)</span>}
                    </span>
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
                    : scanFailed && lastError
                      ? `Error: ${lastError}`
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {mode === 'scanner' && scanning && topCoins.length === 0 ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-[#30363d] bg-[#161b22] min-h-[440px] animate-pulse" />
            ))
          ) : coinsToShow.length === 0 && scanning ? (
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
              <div className="pt-1 text-orange-400/80">Tap <span className="font-semibold">Core 5</span> for BTC · ETH · SOL · XRP · DOGE</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

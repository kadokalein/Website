import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useCoinData } from '../hooks/useCryptoData';
import { COINS } from '../constants';
import PriceChart from '../components/PriceChart';
import VolatilityBadge from '../components/VolatilityBadge';
import MetricRow from '../components/MetricRow';
import EntrySignal from '../components/EntrySignal';
import TimeframeToggle from '../components/TimeframeToggle';

const MACD_COLOR = { bullish: 'text-green-400', bearish: 'text-red-400', neutral: 'text-yellow-400' };

function formatPrice(price) {
  if (price == null) return '—';
  if (price >= 1000) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price);
  if (price >= 1)    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(price);
}
function formatVolume(v) {
  if (v == null) return 'N/A';
  if (v >= 1e9) return `${(v/1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v/1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v/1e3).toFixed(1)}K`;
  return v.toFixed(0);
}
function pct(v, d = 1) { return v == null ? 'N/A' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`; }
function hv(v) { return v != null ? `${v.toFixed(0)}%` : 'N/A'; }

export default function CoinDetail() {
  const { symbol } = useParams();
  const [timeframe, setTimeframe] = useState('1D');

  const coin = COINS.find((c) => c.symbol === symbol);
  const { data, candles, loading, error, lastUpdated, refresh } = useCoinData(symbol, timeframe, 60_000);

  if (!coin) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="text-center">
          <div className="text-[#8b949e] mb-4">Unknown coin: {symbol}</div>
          <Link to="/" className="text-[#58a6ff] hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117]/95 backdrop-blur px-4 sm:px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/Website/logo.svg" alt="Promethea Programs" className="w-6 h-6 rounded-full flex-shrink-0 hidden sm:block" />
            <Link to="/" className="text-[#8b949e] hover:text-white transition-colors text-sm flex items-center gap-1.5">
              ← Dashboard
            </Link>
            <span className="text-[#30363d]">|</span>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: coin.color + '25', color: coin.color }}>
                {coin.symbol.charAt(0)}
              </div>
              <span className="font-semibold text-white">{coin.symbol}</span>
              <span className="text-[#8b949e] text-sm hidden sm:block">{coin.name}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to={`/calculator/${symbol}`}
              className="px-3 py-1.5 rounded-md bg-[#21262d] border border-[#30363d] text-sm text-[#8b949e] hover:text-white hover:border-[#58a6ff]/50 transition-all"
            >
              Calculator →
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">

        {/* Price + badge row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {loading && !data
              ? <div className="h-9 w-40 bg-[#30363d] rounded animate-pulse" />
              : <div className="text-3xl font-mono font-bold text-white tabular-nums">{formatPrice(data?.currentPrice)}</div>
            }
            {lastUpdated && <div className="text-xs text-[#484f58] mt-1">{lastUpdated.toLocaleTimeString()}</div>}
          </div>
          <div className="flex flex-col items-end gap-2">
            {data && <VolatilityBadge level={data.volatility} />}
            <TimeframeToggle value={timeframe} onChange={setTimeframe} />
          </div>
        </div>

        {/* Price chart */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          <div className="text-xs font-semibold text-[#484f58] uppercase tracking-widest mb-3">Price · Bollinger Bands</div>
          {loading && !candles
            ? <div className="h-[240px] flex items-center justify-center text-[#484f58] text-sm">Loading…</div>
            : <PriceChart candles={candles} interval={{ '1H':'1h','4H':'4h','1D':'1d','1W':'1w' }[timeframe]} color={coin.color} coinSymbol={coin.symbol} timeframe={timeframe} />
          }
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/25 bg-[#1a0d0d] p-4 flex items-center justify-between">
            <span className="text-red-400 text-sm">{error}</span>
            <button onClick={refresh} className="px-3 py-1 rounded bg-[#21262d] text-xs text-[#8b949e] hover:text-white">Retry</button>
          </div>
        )}

        {data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Volatility metrics */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
              <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-2">Volatility</div>
              <MetricRow label="ATR (14)" value={formatPrice(data.atr)}
                subtext={`${data.atrPercentile.toFixed(0)}th pct`}
                highlight={data.atrPercentile > 80 ? 'text-red-400' : data.atrPercentile < 20 ? 'text-green-400' : 'text-[#58a6ff]'} />
              <MetricRow label="BB Width" value={`${data.bb.bbw.toFixed(1)}%`}
                subtext={data.isCompressed ? '⚠ compressed' : `${data.bbwPercentile.toFixed(0)}th pct`}
                highlight={data.isCompressed ? 'text-yellow-400' : 'text-white'} />
              <div className="flex justify-between items-center py-[5px]">
                <span className="text-[#8b949e] text-sm">Realized Vol</span>
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-[#484f58]">7d</span><span className="text-white">{hv(data.hv7)}</span>
                  <span className="text-[#30363d]">│</span>
                  <span className="text-[#484f58]">30d</span><span className="text-white">{hv(data.hv30)}</span>
                  <span className="text-[#30363d]">│</span>
                  <span className="text-[#484f58]">90d</span><span className="text-white">{hv(data.hv90)}</span>
                </div>
              </div>
              <MetricRow label="ROC (14)" value={pct(data.roc)}
                highlight={data.roc == null ? 'text-[#8b949e]' : data.roc > 0 ? 'text-green-400' : 'text-red-400'} />
              <MetricRow label="Std Dev" value={formatPrice(data.bb.stdDev)} highlight="text-[#8b949e]" />
            </div>

            {/* Entry indicators */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
              <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-2">Entry Indicators</div>
              <MetricRow label="RSI (14)"
                value={data.rsi != null ? data.rsi.toFixed(1) : 'N/A'}
                subtext={data.rsi != null ? data.rsi < 30 ? 'strongly oversold' : data.rsi < 35 ? 'oversold' : data.rsi > 70 ? 'overbought' : data.rsi > 65 ? 'near overbought' : '' : ''}
                highlight={data.rsi == null ? 'text-[#8b949e]' : data.rsi < 30 ? 'text-green-400' : data.rsi < 35 ? 'text-emerald-400' : data.rsi > 70 ? 'text-red-400' : data.rsi > 65 ? 'text-orange-400' : 'text-white'} />
              <MetricRow label="MACD (12/26/9)"
                value={data.macd ? data.macd.status.charAt(0).toUpperCase() + data.macd.status.slice(1) : 'N/A'}
                subtext={data.macd?.isBullishCrossover ? '↑ crossover' : ''}
                highlight={data.macd ? MACD_COLOR[data.macd.status] : 'text-[#8b949e]'} />
              {data.volume && (
                <MetricRow label="Volume"
                  value={`${data.volume.ratio.toFixed(2)}× avg`}
                  subtext={formatVolume(data.volume.current)}
                  highlight={data.volume.ratio >= 1.5 ? 'text-green-400' : data.volume.ratio >= 1.2 ? 'text-emerald-400' : data.volume.ratio < 0.5 ? 'text-red-400' : 'text-[#8b949e]'} />
              )}
              <div className="border-t border-[#30363d]/50 my-2.5" />
              <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-2">Entry Zones</div>
              <MetricRow label="Conservative (1.5×ATR)" value={formatPrice(data.conservativeEntry)} highlight="text-[#58a6ff]" />
              <MetricRow label="Aggressive (2×ATR)" value={formatPrice(data.aggressiveEntry)} highlight="text-[#bc8cff]" />
            </div>

            {/* BB levels */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
              <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-2">Bollinger Band Levels</div>
              <MetricRow label="Upper Band"  value={formatPrice(data.bb.upper)}  highlight="text-red-400" />
              <MetricRow label="Middle (SMA)" value={formatPrice(data.bb.middle)} highlight="text-[#8b949e]" />
              <MetricRow label="Lower Band"  value={formatPrice(data.bb.lower)}  highlight="text-green-400" />
              <MetricRow label="Band Width"  value={`${data.bb.bbw.toFixed(2)}%`} highlight="text-white" />
            </div>

            {/* Entry signal */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
              <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-2">Entry Signal</div>
              <EntrySignal conditions={data.conditions} activeConditions={data.activeConditions} entrySignal={data.entrySignal} />
            </div>

          </div>
        )}
      </main>
    </div>
  );
}

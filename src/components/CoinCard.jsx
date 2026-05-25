import { useCoinData } from '../hooks/useCryptoData';
import VolatilityBadge from './VolatilityBadge';
import EntrySignal from './EntrySignal';
import MetricRow from './MetricRow';

// Card background tints based on volatility level (subtle but visible)
const CARD_STYLE = {
  low:    'bg-[#0d1a14] border-green-500/20',
  medium: 'bg-[#161b22] border-[#30363d]',
  high:   'bg-[#1a0d0d] border-red-500/20',
};

const MACD_COLOR = { bullish: 'text-green-400', bearish: 'text-red-400', neutral: 'text-yellow-400' };

// --- Formatters ---

function formatPrice(price) {
  if (price == null) return '—';
  if (price >= 1000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(price);
  }
  if (price >= 1) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(price);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 4, maximumFractionDigits: 6,
  }).format(price);
}

function formatVolume(vol) {
  if (vol == null) return 'N/A';
  if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)}B`;
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
  return vol.toFixed(0);
}

function pct(val, decimals = 1) {
  if (val == null) return 'N/A';
  return `${val >= 0 ? '+' : ''}${val.toFixed(decimals)}%`;
}

function hvStr(val) {
  return val != null ? `${val.toFixed(0)}%` : 'N/A';
}

// --- Skeleton placeholder row ---
function SkeletonRow() {
  return <div className="h-5 rounded bg-[#30363d] animate-pulse my-[5px]" />;
}

// --- Main card ---
export default function CoinCard({ symbol, binanceSymbol, name, color, timeframe }) {
  const { data, loading, error, lastUpdated, refresh } = useCoinData(binanceSymbol, timeframe);

  const cardStyle = data ? (CARD_STYLE[data.volatility] ?? CARD_STYLE.medium) : 'bg-[#161b22] border-[#30363d]';

  // Error state
  if (error && !data) {
    return (
      <div className="rounded-xl border bg-[#1a0d0d] border-red-500/25 p-6 flex flex-col items-center justify-center min-h-[440px] gap-3">
        <div className="text-4xl">⚠️</div>
        <div className="text-red-400 text-sm font-medium">Failed to load {symbol}</div>
        <div className="text-[#8b949e] text-xs text-center max-w-[200px]">{error}</div>
        <button
          onClick={refresh}
          className="mt-2 px-4 py-1.5 rounded-md bg-[#21262d] text-[#8b949e] text-sm hover:text-white hover:bg-[#30363d] transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border transition-colors duration-500 ${cardStyle} overflow-hidden flex flex-col`}>

      {/* ── Header ── */}
      <div className="p-5 pb-3">
        <div className="flex items-start justify-between mb-3">
          {/* Coin identity */}
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{ backgroundColor: color + '25', color }}
            >
              {symbol.charAt(0)}
            </div>
            <div>
              <div className="font-semibold text-white leading-tight">{symbol}</div>
              <div className="text-xs text-[#8b949e]">{name}</div>
            </div>
          </div>

          {/* Live price */}
          <div className="text-right">
            {loading && !data ? (
              <div className="h-6 w-28 bg-[#30363d] rounded animate-pulse" />
            ) : (
              <div className="text-xl font-mono font-bold text-white tabular-nums">
                {formatPrice(data?.currentPrice)}
              </div>
            )}
          </div>
        </div>

        {/* Volatility badge + last-updated timestamp */}
        <div className="flex items-center justify-between">
          {loading && !data ? (
            <div className="h-5 w-20 bg-[#30363d] rounded animate-pulse" />
          ) : data ? (
            <VolatilityBadge level={data.volatility} />
          ) : null}
          {lastUpdated && (
            <span className="text-[11px] text-[#484f58]">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-[#30363d]/50" />

      {/* ── Metrics ── */}
      <div className="p-5 pt-3 flex-1">
        {loading && !data ? (
          <div className="space-y-0.5">
            {Array.from({ length: 9 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : data ? (
          <>
            {/* ── Volatility block ── */}
            <div className="mb-1">
              <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-1">
                Volatility
              </div>

              <MetricRow
                label="ATR (14)"
                value={formatPrice(data.atr)}
                subtext={`${data.atrPercentile.toFixed(0)}th pct`}
                highlight={
                  data.atrPercentile > 80 ? 'text-red-400' :
                  data.atrPercentile < 20 ? 'text-green-400' :
                  'text-[#58a6ff]'
                }
              />

              <MetricRow
                label="BB Width"
                value={`${data.bb.bbw.toFixed(1)}%`}
                subtext={
                  data.isCompressed
                    ? '⚠ compressed'
                    : `${data.bbwPercentile.toFixed(0)}th pct`
                }
                highlight={data.isCompressed ? 'text-yellow-400' : 'text-white'}
              />

              {/* HV row — three timeframes inline */}
              <div className="flex justify-between items-center py-[5px]">
                <span className="text-[#8b949e] text-sm">Realized Vol</span>
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-[#484f58]">7d</span>
                  <span className="text-white">{hvStr(data.hv7)}</span>
                  <span className="text-[#30363d]">│</span>
                  <span className="text-[#484f58]">30d</span>
                  <span className="text-white">{hvStr(data.hv30)}</span>
                  <span className="text-[#30363d]">│</span>
                  <span className="text-[#484f58]">90d</span>
                  <span className="text-white">{hvStr(data.hv90)}</span>
                </div>
              </div>

              <MetricRow
                label="ROC (14)"
                value={pct(data.roc)}
                highlight={
                  data.roc == null ? 'text-[#8b949e]' :
                  Math.abs(data.roc) > 10 ? (data.roc > 0 ? 'text-green-400' : 'text-red-400') :
                  data.roc > 0 ? 'text-emerald-400' : 'text-orange-400'
                }
              />

              <MetricRow
                label="Std Dev (BB)"
                value={formatPrice(data.bb.stdDev)}
                highlight="text-[#8b949e]"
              />
            </div>

            <div className="border-t border-[#30363d]/50 my-2.5" />

            {/* ── Entry signals block ── */}
            <div className="mb-1">
              <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-1">
                Entry Indicators
              </div>

              <MetricRow
                label="RSI (14)"
                value={data.rsi != null ? data.rsi.toFixed(1) : 'N/A'}
                subtext={
                  data.rsi != null
                    ? data.rsi < 30 ? 'strongly oversold'
                    : data.rsi < 35 ? 'oversold'
                    : data.rsi > 70 ? 'overbought'
                    : data.rsi > 65 ? 'near overbought'
                    : ''
                    : ''
                }
                highlight={
                  data.rsi == null ? 'text-[#8b949e]' :
                  data.rsi < 30    ? 'text-green-400' :
                  data.rsi < 35    ? 'text-emerald-400' :
                  data.rsi > 70    ? 'text-red-400' :
                  data.rsi > 65    ? 'text-orange-400' :
                  'text-white'
                }
              />

              <MetricRow
                label="MACD (12/26/9)"
                value={
                  data.macd
                    ? data.macd.status.charAt(0).toUpperCase() + data.macd.status.slice(1)
                    : 'N/A'
                }
                subtext={data.macd?.isBullishCrossover ? '↑ crossover' : ''}
                highlight={data.macd ? MACD_COLOR[data.macd.status] : 'text-[#8b949e]'}
              />

              {data.volume && (
                <MetricRow
                  label="Volume"
                  value={`${data.volume.ratio.toFixed(2)}× avg`}
                  subtext={formatVolume(data.volume.current)}
                  highlight={
                    data.volume.ratio >= 1.5 ? 'text-green-400' :
                    data.volume.ratio >= 1.2 ? 'text-emerald-400' :
                    data.volume.ratio < 0.5  ? 'text-red-400' :
                    'text-[#8b949e]'
                  }
                />
              )}
            </div>

            <div className="border-t border-[#30363d]/50 my-2.5" />

            {/* ── Entry zones ── */}
            <div className="mb-3">
              <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-1">
                Entry Zones
              </div>
              <MetricRow
                label="Conservative (1.5×ATR)"
                value={formatPrice(data.conservativeEntry)}
                highlight="text-[#58a6ff]"
              />
              <MetricRow
                label="Aggressive (2×ATR)"
                value={formatPrice(data.aggressiveEntry)}
                highlight="text-[#bc8cff]"
              />
            </div>

            {/* ── Entry signal ── */}
            <EntrySignal
              conditions={data.conditions}
              activeConditions={data.activeConditions}
              entrySignal={data.entrySignal}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

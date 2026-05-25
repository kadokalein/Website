import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useCoinData } from '../hooks/useCryptoData';
import { COINS } from '../constants';
import PriceChart from '../components/PriceChart';

// ── Formatters ──────────────────────────────────────────────────────────────

function fmtPrice(price) {
  if (price == null) return '—';
  if (price >= 1000) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price);
  if (price >= 1)    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(price);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(price);
}

function fmtDollars(val) {
  if (val == null) return '—';
  const abs = Math.abs(val);
  const str = abs >= 1000
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(val)
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(val);
  return str;
}

function fmtPct(v) {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

// ── Sell target calculations ────────────────────────────────────────────────

function calcTargets(buyPrice, coinsOwned, data) {
  const { atr, bb } = data;

  const mkTarget = (label, price, note = '') => ({
    label,
    price,
    note,
    pct:        ((price - buyPrice) / buyPrice) * 100,
    profitPerCoin: price - buyPrice,
    totalProfit: coinsOwned * (price - buyPrice),
  });

  return [
    mkTarget('Stop Loss',     buyPrice - 1.0 * atr, '1× ATR below entry'),
    mkTarget('Break-even',    buyPrice,              'Your entry price'),
    mkTarget('Conservative',  buyPrice + 1.5 * atr,  '1.5× ATR above entry'),
    mkTarget('Standard',      buyPrice + 2.0 * atr,  '2× ATR above entry'),
    mkTarget('Aggressive',    buyPrice + 3.0 * atr,  '3× ATR above entry'),
    mkTarget('BB Upper Band', bb.upper,              'Bollinger resistance'),
  ];
}

// ── Signal assessment ────────────────────────────────────────────────────────

function assessSignals(data, buyPrice) {
  const signals = [];
  const { currentPrice, rsi, macd, bb, atr, volatility } = data;

  if (currentPrice < buyPrice - atr) {
    signals.push({ type: 'danger', icon: '🔴', text: 'Stop loss level hit — consider cutting losses' });
  }
  if (rsi != null && rsi > 70) {
    signals.push({ type: 'sell', icon: '🔴', text: `RSI ${rsi.toFixed(0)} — overbought, consider taking profits` });
  } else if (rsi != null && rsi > 65) {
    signals.push({ type: 'caution', icon: '🟡', text: `RSI ${rsi.toFixed(0)} — approaching overbought` });
  }
  if (currentPrice > bb.upper) {
    signals.push({ type: 'sell', icon: '🔴', text: 'Price above BB upper — extended, high-risk zone' });
  }
  if (macd?.status === 'bearish') {
    signals.push({ type: 'caution', icon: '🟡', text: 'MACD bearish — downward momentum building' });
  }
  if (macd?.isBullishCrossover) {
    signals.push({ type: 'hold', icon: '🟢', text: 'MACD bullish crossover — upward momentum' });
  }
  if (volatility === 'high') {
    signals.push({ type: 'caution', icon: '🟡', text: 'High volatility — use tighter stops' });
  }
  if (currentPrice >= buyPrice + 2 * atr) {
    signals.push({ type: 'sell', icon: '🟡', text: 'Standard target reached — consider taking partial profits' });
  }

  if (signals.length === 0) {
    signals.push({ type: 'hold', icon: '🟢', text: 'No exit signals — position looks healthy, hold' });
  }
  return signals;
}

// ── Target row ───────────────────────────────────────────────────────────────

function TargetRow({ target, currentPrice, isEntry }) {
  const isStop = target.label === 'Stop Loss';
  const isEntry2 = target.label === 'Break-even';
  const hit = !isStop && !isEntry2 && currentPrice >= target.price;
  const stopped = isStop && currentPrice <= target.price;

  let rowBg = '';
  if (hit) rowBg = 'bg-green-900/10 border border-green-500/20 rounded-lg';
  if (stopped) rowBg = 'bg-red-900/10 border border-red-500/20 rounded-lg';

  const pctColor = isStop
    ? 'text-red-400'
    : isEntry2
    ? 'text-[#8b949e]'
    : target.pct > 0 ? 'text-green-400' : 'text-[#8b949e]';

  const profitColor = target.totalProfit > 0 ? 'text-green-400' : target.totalProfit < 0 ? 'text-red-400' : 'text-[#8b949e]';

  return (
    <div className={`flex items-center justify-between py-2 px-2 ${rowBg}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-medium ${isStop ? 'text-red-400' : isEntry2 ? 'text-[#8b949e]' : 'text-white'}`}>
            {target.label}
          </span>
          {hit && <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full">Reached</span>}
          {stopped && <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">Triggered</span>}
        </div>
        <div className="text-[10px] text-[#484f58] mt-0.5">{target.note}</div>
      </div>
      <div className="text-right flex-shrink-0 ml-3">
        <div className="text-sm font-mono text-white">{fmtPrice(target.price)}</div>
        <div className="flex gap-2 justify-end text-xs font-mono mt-0.5">
          <span className={pctColor}>{fmtPct(target.pct)}</span>
          <span className={profitColor}>{target.totalProfit !== 0 ? fmtDollars(target.totalProfit) : ''}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Calculator() {
  const { symbol: paramSymbol } = useParams();
  const [selectedSymbol, setSelectedSymbol] = useState(paramSymbol ?? 'BTC');
  const [buyPriceInput, setBuyPriceInput] = useState('');
  const [amountInput, setAmountInput] = useState('');

  const coin = COINS.find((c) => c.symbol === selectedSymbol) ?? COINS[0];
  const { data, candles, loading } = useCoinData(selectedSymbol, '1D');

  const buyPrice   = parseFloat(buyPriceInput.replace(/,/g, '')) || null;
  const buyAmount  = parseFloat(amountInput.replace(/,/g, ''))   || null;
  const coinsOwned = buyPrice && buyAmount ? buyAmount / buyPrice : null;

  const results = useMemo(() => {
    if (!data || !buyPrice || !coinsOwned) return null;
    const targets  = calcTargets(buyPrice, coinsOwned, data);
    const signals  = assessSignals(data, buyPrice);
    const curValue = coinsOwned * data.currentPrice;
    const pnl      = curValue - buyAmount;
    const pnlPct   = ((data.currentPrice - buyPrice) / buyPrice) * 100;
    return { targets, signals, curValue, pnl, pnlPct };
  }, [data, buyPrice, coinsOwned, buyAmount]);

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">

      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117]/95 backdrop-blur px-4 sm:px-6 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-[#8b949e] hover:text-white text-sm">← Dashboard</Link>
            <span className="text-[#30363d]">|</span>
            <span className="font-semibold text-white">Trade Calculator</span>
          </div>
          {paramSymbol && (
            <Link to={`/coin/${paramSymbol}`} className="text-xs text-[#8b949e] hover:text-white">
              ← {paramSymbol} detail
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4">

        {/* Inputs card */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Your Trade</h2>

          {/* Coin selector */}
          <div className="mb-4">
            <label className="block text-xs text-[#8b949e] mb-1.5">Coin</label>
            <div className="flex flex-wrap gap-2">
              {COINS.map((c) => (
                <button
                  key={c.symbol}
                  onClick={() => setSelectedSymbol(c.symbol)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                    selectedSymbol === c.symbol
                      ? 'border-[#58a6ff] bg-[#58a6ff]/10 text-[#58a6ff]'
                      : 'border-[#30363d] bg-[#21262d] text-[#8b949e] hover:text-white hover:border-[#484f58]'
                  }`}
                >
                  {c.symbol}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Buy price */}
            <div>
              <label className="block text-xs text-[#8b949e] mb-1.5">
                Price I Bought At
                {data && (
                  <button
                    onClick={() => setBuyPriceInput(data.currentPrice.toFixed(data.currentPrice < 1 ? 6 : data.currentPrice < 10 ? 4 : 2))}
                    className="ml-2 text-[#484f58] hover:text-[#58a6ff] transition-colors"
                  >
                    (use current)
                  </button>
                )}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#484f58] text-sm">$</span>
                <input
                  type="number"
                  value={buyPriceInput}
                  onChange={(e) => setBuyPriceInput(e.target.value)}
                  placeholder={data ? data.currentPrice.toFixed(data.currentPrice < 1 ? 4 : 2) : '0.00'}
                  className="w-full bg-[#21262d] border border-[#30363d] rounded-lg pl-7 pr-3 py-2.5 text-sm text-white placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff]/60 transition-colors"
                />
              </div>
            </div>

            {/* Amount invested */}
            <div>
              <label className="block text-xs text-[#8b949e] mb-1.5">Amount Invested</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#484f58] text-sm">$</span>
                <input
                  type="number"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="500"
                  className="w-full bg-[#21262d] border border-[#30363d] rounded-lg pl-7 pr-3 py-2.5 text-sm text-white placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff]/60 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Derived: coins owned */}
          {coinsOwned != null && (
            <div className="mt-3 pt-3 border-t border-[#30363d]/50 flex items-center justify-between text-sm">
              <span className="text-[#8b949e]">Coins owned</span>
              <span className="font-mono text-white">
                {coinsOwned < 0.001 ? coinsOwned.toFixed(6) : coinsOwned < 1 ? coinsOwned.toFixed(4) : coinsOwned.toFixed(2)} {selectedSymbol}
              </span>
            </div>
          )}
        </div>

        {/* Current market snapshot */}
        {data && (
          <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
            <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-3">Current Market — {selectedSymbol}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="flex justify-between py-1">
                <span className="text-[#8b949e] text-sm">Price</span>
                <span className="font-mono text-sm text-white">{fmtPrice(data.currentPrice)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[#8b949e] text-sm">ATR (14)</span>
                <span className="font-mono text-sm text-[#58a6ff]">{fmtPrice(data.atr)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[#8b949e] text-sm">RSI</span>
                <span className={`font-mono text-sm ${data.rsi > 70 ? 'text-red-400' : data.rsi < 35 ? 'text-green-400' : 'text-white'}`}>
                  {data.rsi?.toFixed(1) ?? 'N/A'}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[#8b949e] text-sm">MACD</span>
                <span className={`font-mono text-sm ${data.macd?.status === 'bullish' ? 'text-green-400' : data.macd?.status === 'bearish' ? 'text-red-400' : 'text-yellow-400'}`}>
                  {data.macd?.status ? data.macd.status.charAt(0).toUpperCase() + data.macd.status.slice(1) : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[#8b949e] text-sm">BB Upper</span>
                <span className="font-mono text-sm text-red-400">{fmtPrice(data.bb.upper)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[#8b949e] text-sm">Volatility</span>
                <span className={`font-mono text-sm ${data.volatility === 'high' ? 'text-red-400' : data.volatility === 'low' ? 'text-green-400' : 'text-yellow-400'}`}>
                  {data.volatility.charAt(0).toUpperCase() + data.volatility.slice(1)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── RESULTS (shown once inputs are filled) ── */}
        {results && data && (
          <>
            {/* P&L summary */}
            <div className={`rounded-xl border p-4 ${
              results.pnl > 0 ? 'bg-green-900/15 border-green-500/30' : results.pnl < 0 ? 'bg-red-900/15 border-red-500/30' : 'bg-[#161b22] border-[#30363d]'
            }`}>
              <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-3">Position Summary</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-[#8b949e] mb-0.5">Invested</div>
                  <div className="text-lg font-mono font-semibold text-white">{fmtDollars(buyAmount)}</div>
                </div>
                <div>
                  <div className="text-xs text-[#8b949e] mb-0.5">Current Value</div>
                  <div className="text-lg font-mono font-semibold text-white">{fmtDollars(results.curValue)}</div>
                </div>
                <div>
                  <div className="text-xs text-[#8b949e] mb-0.5">Unrealized P&amp;L</div>
                  <div className={`text-lg font-mono font-semibold ${results.pnl > 0 ? 'text-green-400' : results.pnl < 0 ? 'text-red-400' : 'text-white'}`}>
                    {fmtDollars(results.pnl)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#8b949e] mb-0.5">Return</div>
                  <div className={`text-lg font-mono font-semibold ${results.pnlPct > 0 ? 'text-green-400' : results.pnlPct < 0 ? 'text-red-400' : 'text-white'}`}>
                    {fmtPct(results.pnlPct)}
                  </div>
                </div>
              </div>
            </div>

            {/* Sell targets */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
              <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-1">Sell Targets</div>
              <div className="text-[10px] text-[#484f58] mb-3">Based on current ATR ({fmtPrice(data.atr)}) and Bollinger Bands</div>
              <div className="space-y-1">
                {results.targets.map((t) => (
                  <TargetRow key={t.label} target={t} currentPrice={data.currentPrice} />
                ))}
              </div>
            </div>

            {/* Price chart with entry marked */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
              <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-3">Price Chart · Entry Line</div>
              {candles
                ? <PriceChart candles={candles} interval="1d" color={coin.color} buyPrice={buyPrice} />
                : <div className="h-[240px] flex items-center justify-center text-[#484f58] text-sm">Loading…</div>
              }
              <div className="mt-2 text-[10px] text-[#484f58]">Yellow dashed line = your entry price</div>
            </div>

            {/* Signal assessment */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
              <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-3">Current Signals</div>
              <div className="space-y-2">
                {results.signals.map((s, i) => (
                  <div key={i} className={`flex items-start gap-2.5 p-2.5 rounded-lg ${
                    s.type === 'sell'   ? 'bg-red-900/15 border border-red-500/20' :
                    s.type === 'danger' ? 'bg-red-900/25 border border-red-500/40' :
                    s.type === 'caution'? 'bg-yellow-900/15 border border-yellow-500/20' :
                    'bg-green-900/10 border border-green-500/15'
                  }`}>
                    <span className="text-base leading-none mt-px">{s.icon}</span>
                    <span className="text-sm text-white">{s.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Risk/Reward summary */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
              <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-3">Risk / Reward</div>
              {(() => {
                const stopLoss = results.targets[0];
                const standard = results.targets[3];
                const risk     = Math.abs(stopLoss.totalProfit);
                const reward   = standard.totalProfit;
                const rr       = risk > 0 ? reward / risk : null;
                return (
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-xs text-[#8b949e] mb-1">Max Risk</div>
                      <div className="font-mono text-sm text-red-400">{fmtDollars(-risk)}</div>
                      <div className="text-[10px] text-[#484f58]">at stop loss</div>
                    </div>
                    <div>
                      <div className="text-xs text-[#8b949e] mb-1">Target Reward</div>
                      <div className="font-mono text-sm text-green-400">{fmtDollars(reward)}</div>
                      <div className="text-[10px] text-[#484f58]">at std target</div>
                    </div>
                    <div>
                      <div className="text-xs text-[#8b949e] mb-1">R:R Ratio</div>
                      <div className={`font-mono text-sm font-semibold ${rr >= 2 ? 'text-green-400' : rr >= 1.5 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {rr != null ? `1 : ${rr.toFixed(1)}` : '—'}
                      </div>
                      <div className="text-[10px] text-[#484f58]">{rr >= 2 ? 'Favorable' : rr >= 1.5 ? 'Acceptable' : 'Poor'}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </>
        )}

        {/* Prompt to fill in inputs */}
        {data && !buyPrice && (
          <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-6 text-center text-[#8b949e] text-sm">
            Enter the price you bought {selectedSymbol} at and your investment amount to see sell targets and P&amp;L.
          </div>
        )}

        {loading && !data && (
          <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-6 text-center text-[#8b949e] text-sm">
            Loading {selectedSymbol} data…
          </div>
        )}

      </main>
    </div>
  );
}

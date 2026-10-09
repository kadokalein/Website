import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useCryptoScanner } from '../hooks/useCryptoScanner';
import { fetchCandles } from '../utils/binanceApi';
import { analyzeCandles } from '../utils/indicators';
import { computeRunScore } from '../utils/scoring';
import { SCAN_UNIVERSE } from '../constants';

const STORAGE_KEY = 'pp_paper_v1';
const START_BALANCE = 5000;
const POSITION_SIZE = 0.15;   // 15% of cash per trade
const STOP_LOSS     = -0.05;  // -5%
const TAKE_PROFIT   =  0.08;  // +8%
const EXIT_SCORE    = 25;     // exit if score drops below this
const MAX_POSITIONS = 4;
const PRICE_REFRESH = 60_000; // fetch live prices every 60s

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return null;
}

function initialState() {
  return {
    cash: START_BALANCE,
    startBalance: START_BALANCE,
    holdings: {},      // symbol → { qty, entryPrice, entryTime, entryScore }
    trades: [],        // closed trade log
    autoEnabled: false,
    lastAutoAt: null,
  };
}

function pnlPct(holding, price) {
  return ((price - holding.entryPrice) / holding.entryPrice) * 100;
}

function formatUSD(v) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

function formatPrice(price) {
  if (price == null) return '—';
  if (price >= 1000) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price);
  if (price >= 1) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(price);
}

function SignalBadge({ signal }) {
  const cfg = {
    'BUY TRIGGERED': 'bg-green-500/15 text-green-300 border-green-500/30',
    'WATCH':         'bg-yellow-500/10 text-yellow-400 border-yellow-500/25',
    'LOW QUALITY':   'bg-blue-500/10 text-blue-400 border-blue-500/25',
    'NO SIGNAL':     'bg-[#30363d] text-[#484f58] border-[#484f58]/30',
  }[signal] ?? 'bg-[#30363d] text-[#484f58] border-[#484f58]/30';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cfg}`}>{signal}</span>
  );
}

export default function PaperTrading() {
  const [portfolio, setPortfolio] = useState(() => loadState() ?? initialState());
  const [prices, setPrices]     = useState({});   // symbol → current price
  const [scores, setScores]     = useState({});   // symbol → runScore
  const [aiLog, setAiLog]       = useState([]);   // AI decision log (last 20)
  const [refreshing, setRefreshing] = useState(false);
  const autoRef = useRef(portfolio.autoEnabled);
  autoRef.current = portfolio.autoEnabled;

  // Persist to localStorage on every change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio)); } catch { /* */ }
  }, [portfolio]);

  // Fetch current prices for all held coins + top scan candidates
  const refreshPrices = useCallback(async () => {
    setRefreshing(true);
    const symbols = new Set([...Object.keys(portfolio.holdings), ...SCAN_UNIVERSE.slice(0, 10).map(c => c.symbol)]);
    const freshPrices = {};
    const freshScores = {};
    await Promise.allSettled([...symbols].map(async symbol => {
      try {
        const { candles, interval } = await fetchCandles(symbol, '4H');
        const analysis = analyzeCandles(candles, interval);
        const rs = computeRunScore(analysis);
        freshPrices[symbol] = analysis.currentPrice;
        freshScores[symbol] = rs;
      } catch { /* ignore */ }
    }));
    setPrices(p => ({ ...p, ...freshPrices }));
    setScores(p => ({ ...p, ...freshScores }));
    setRefreshing(false);
    return { freshPrices, freshScores };
  }, [portfolio.holdings]);

  // Initial price load
  useEffect(() => { refreshPrices(); }, []);

  // Auto-trading engine: runs when prices/scores update and auto is enabled
  const runAI = useCallback(async (freshPrices, freshScores) => {
    if (!autoRef.current) return;

    const now = new Date().toISOString();

    setPortfolio(prev => {
      const p = JSON.parse(JSON.stringify(prev)); // deep clone
      const log = [];

      // --- CHECK EXITS FIRST ---
      for (const [symbol, holding] of Object.entries(p.holdings)) {
        const price = freshPrices[symbol] ?? prices[symbol];
        if (!price) continue;
        const pnl = pnlPct(holding, price);
        const score = freshScores[symbol]?.score ?? 0;
        let reason = null;

        if (pnl <= STOP_LOSS * 100) reason = `Stop loss hit (${pnl.toFixed(1)}%)`;
        else if (pnl >= TAKE_PROFIT * 100) reason = `Take profit hit (${pnl.toFixed(1)}%)`;
        else if (score < EXIT_SCORE) reason = `Score dropped to ${score} (< ${EXIT_SCORE})`;

        if (reason) {
          const proceeds = holding.qty * price;
          const gainLoss = proceeds - (holding.qty * holding.entryPrice);
          p.cash += proceeds;
          p.trades.unshift({
            id: Date.now() + symbol,
            symbol,
            side: 'SELL',
            qty: holding.qty,
            price,
            entryPrice: holding.entryPrice,
            gainLoss,
            pnlPct: pnl,
            reason,
            time: now,
          });
          delete p.holdings[symbol];
          log.push(`SOLD ${symbol}: ${reason} (${gainLoss >= 0 ? '+' : ''}${formatUSD(gainLoss)})`);
        }
      }

      // --- CHECK ENTRIES ---
      const openPositions = Object.keys(p.holdings).length;
      if (openPositions < MAX_POSITIONS && p.cash > 50) {
        // Sort candidates by score descending
        const candidates = Object.entries(freshScores)
          .filter(([sym, rs]) =>
            rs?.signal === 'BUY TRIGGERED' &&
            !p.holdings[sym] &&
            (freshPrices[sym] ?? 0) > 0
          )
          .sort((a, b) => (b[1]?.score ?? 0) - (a[1]?.score ?? 0));

        for (const [symbol, rs] of candidates) {
          if (Object.keys(p.holdings).length >= MAX_POSITIONS) break;
          const price = freshPrices[symbol];
          if (!price) continue;
          const spend = p.cash * POSITION_SIZE;
          if (spend < 10) break;
          const qty = spend / price;
          p.cash -= spend;
          p.holdings[symbol] = {
            qty,
            entryPrice: price,
            entryTime: now,
            entryScore: rs?.score ?? 0,
          };
          p.trades.unshift({
            id: Date.now() + symbol + 'B',
            symbol,
            side: 'BUY',
            qty,
            price,
            reason: rs?.triggerReason ?? `Score ${rs?.score}`,
            time: now,
          });
          log.push(`BOUGHT ${symbol} @ ${formatPrice(price)} — Score ${rs?.score} · ${rs?.triggerReason ?? ''}`);
        }
      }

      if (log.length) {
        p.lastAutoAt = now;
        setAiLog(prev => [...log.map(m => ({ msg: m, time: now })), ...prev].slice(0, 30));
      }

      return p;
    });
  }, [prices]);

  // Periodic price refresh
  useEffect(() => {
    const timer = setInterval(async () => {
      const { freshPrices, freshScores } = await refreshPrices();
      if (autoRef.current) runAI(freshPrices, freshScores);
    }, PRICE_REFRESH);
    return () => clearInterval(timer);
  }, [refreshPrices, runAI]);

  // Manual trade
  function manualBuy(symbol) {
    const price = prices[symbol];
    if (!price) return;
    const rs = scores[symbol];
    setPortfolio(prev => {
      if (prev.holdings[symbol]) return prev;
      if (Object.keys(prev.holdings).length >= MAX_POSITIONS) return prev;
      const spend = prev.cash * POSITION_SIZE;
      if (spend < 10) return prev;
      const qty = spend / price;
      const now = new Date().toISOString();
      return {
        ...prev,
        cash: prev.cash - spend,
        holdings: { ...prev.holdings, [symbol]: { qty, entryPrice: price, entryTime: now, entryScore: rs?.score ?? 0 } },
        trades: [{ id: Date.now() + symbol, symbol, side: 'BUY', qty, price, reason: 'Manual', time: now }, ...prev.trades],
      };
    });
  }

  function manualSell(symbol) {
    const price = prices[symbol];
    setPortfolio(prev => {
      const holding = prev.holdings[symbol];
      if (!holding) return prev;
      const sellPrice = price ?? holding.entryPrice;
      const proceeds = holding.qty * sellPrice;
      const gainLoss = proceeds - (holding.qty * holding.entryPrice);
      const pnl = ((sellPrice - holding.entryPrice) / holding.entryPrice) * 100;
      const now = new Date().toISOString();
      const newHoldings = { ...prev.holdings };
      delete newHoldings[symbol];
      return {
        ...prev,
        cash: prev.cash + proceeds,
        holdings: newHoldings,
        trades: [{ id: Date.now() + symbol, symbol, side: 'SELL', qty: holding.qty, price: sellPrice, entryPrice: holding.entryPrice, gainLoss, pnlPct: pnl, reason: 'Manual', time: now }, ...prev.trades],
      };
    });
  }

  function resetPortfolio() {
    if (!confirm('Reset paper portfolio? All trades and positions will be cleared.')) return;
    const fresh = initialState();
    setPortfolio(fresh);
    setAiLog([]);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh)); } catch { /* */ }
  }

  // Computed totals
  const holdingsValue = Object.entries(portfolio.holdings).reduce((sum, [sym, h]) => {
    return sum + h.qty * (prices[sym] ?? h.entryPrice);
  }, 0);
  const totalValue = portfolio.cash + holdingsValue;
  const totalPnl   = totalValue - portfolio.startBalance;
  const totalPnlPct = (totalPnl / portfolio.startBalance) * 100;
  const closedTrades = portfolio.trades.filter(t => t.side === 'SELL');
  const winRate = closedTrades.length > 0
    ? (closedTrades.filter(t => (t.gainLoss ?? 0) > 0).length / closedTrades.length * 100).toFixed(0)
    : null;

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <header className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117]/95 backdrop-blur px-4 sm:px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/Website/logo.svg" alt="" className="w-6 h-6 rounded-full flex-shrink-0 hidden sm:block" />
            <Link to="/" className="text-[#8b949e] hover:text-white transition-colors text-sm">← Dashboard</Link>
            <span className="text-[#30363d]">|</span>
            <span className="font-semibold text-white text-sm">Paper Trading</span>
            <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 text-[10px] font-semibold border border-blue-500/30">SIMULATED</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshPrices().then(({ freshPrices, freshScores }) => runAI(freshPrices, freshScores))}
              disabled={refreshing}
              className="px-3 py-1.5 rounded-md text-xs bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white transition-colors disabled:opacity-40"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <Link to="/live" className="px-3 py-1.5 rounded-md text-xs bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/25 transition-colors">
              Live Trading →
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Portfolio summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Value', value: formatUSD(totalValue), sub: `${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}% all-time`, color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400' },
            { label: 'Cash', value: formatUSD(portfolio.cash), sub: `${((portfolio.cash / totalValue) * 100).toFixed(0)}% of portfolio`, color: 'text-white' },
            { label: 'Holdings Value', value: formatUSD(holdingsValue), sub: `${Object.keys(portfolio.holdings).length} open positions`, color: 'text-[#58a6ff]' },
            { label: 'Win Rate', value: winRate != null ? `${winRate}%` : '—', sub: `${closedTrades.length} closed trades`, color: winRate >= 50 ? 'text-green-400' : 'text-[#8b949e]' },
          ].map(card => (
            <div key={card.label} className="rounded-xl border border-[#30363d] bg-[#161b22] p-3">
              <div className="text-[10px] text-[#484f58] font-semibold uppercase tracking-widest mb-1">{card.label}</div>
              <div className={`text-lg font-mono font-bold ${card.color}`}>{card.value}</div>
              <div className="text-[10px] text-[#484f58] mt-0.5">{card.sub}</div>
            </div>
          ))}
        </div>

        {/* AI Auto-trading controls */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white flex items-center gap-2">
              AI Auto-Trading
              {portfolio.autoEnabled && (
                <span className="inline-flex items-center gap-1 text-[10px] text-green-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                  Active
                </span>
              )}
            </div>
            <div className="text-[10px] text-[#484f58] mt-0.5">
              Strategy: BUY TRIGGERED → 15% of cash · Stop {(STOP_LOSS*100).toFixed(0)}% · Target +{(TAKE_PROFIT*100).toFixed(0)}% · Max {MAX_POSITIONS} positions · Exit if score &lt; {EXIT_SCORE}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPortfolio(p => ({ ...p, autoEnabled: !p.autoEnabled }))}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                portfolio.autoEnabled
                  ? 'bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25'
                  : 'bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25'
              }`}
            >
              {portfolio.autoEnabled ? 'Stop AI' : 'Start AI'}
            </button>
            <button onClick={resetPortfolio} className="px-3 py-1.5 rounded-lg text-xs bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-red-400 transition-colors">
              Reset
            </button>
          </div>
        </div>

        {/* Open positions */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#30363d] flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Open Positions ({Object.keys(portfolio.holdings).length}/{MAX_POSITIONS})</div>
          </div>
          {Object.keys(portfolio.holdings).length === 0 ? (
            <div className="px-4 py-6 text-center text-[#484f58] text-sm">No open positions. {portfolio.autoEnabled ? 'AI is scanning…' : 'Enable AI auto-trading or buy manually below.'}</div>
          ) : (
            <div className="divide-y divide-[#30363d]">
              {Object.entries(portfolio.holdings).map(([symbol, h]) => {
                const price = prices[symbol] ?? h.entryPrice;
                const value = h.qty * price;
                const pnl = pnlPct(h, price);
                const rs = scores[symbol];
                return (
                  <div key={symbol} className="px-4 py-3 flex flex-wrap items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#21262d] flex items-center justify-center text-xs font-bold text-[#58a6ff]">
                      {symbol.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <div className="text-sm font-semibold text-white">{symbol}</div>
                      <div className="text-[10px] text-[#484f58]">Entry {formatPrice(h.entryPrice)} · Score {h.entryScore}</div>
                    </div>
                    <div className="text-right min-w-[80px]">
                      <div className="text-sm font-mono font-semibold text-white">{formatPrice(price)}</div>
                      <div className={`text-[10px] font-mono ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}% · {formatUSD(value)}
                      </div>
                    </div>
                    {rs && <SignalBadge signal={rs.signal} />}
                    <button onClick={() => manualSell(symbol)} className="px-3 py-1 rounded bg-red-500/15 border border-red-500/30 text-red-400 text-xs hover:bg-red-500/25 transition-colors">
                      Sell
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top signals — manual buy */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#30363d]">
            <div className="text-sm font-semibold text-white">Top Signals</div>
            <div className="text-[10px] text-[#484f58] mt-0.5">Prices fetched live · scored by weighted engine</div>
          </div>
          {Object.keys(scores).length === 0 ? (
            <div className="px-4 py-6 text-center text-[#484f58] text-sm">Loading market data…</div>
          ) : (
            <div className="divide-y divide-[#30363d]">
              {Object.entries(scores)
                .filter(([, rs]) => rs?.score >= 40)
                .sort((a, b) => (b[1]?.score ?? 0) - (a[1]?.score ?? 0))
                .slice(0, 8)
                .map(([symbol, rs]) => {
                  const price = prices[symbol];
                  const held = portfolio.holdings[symbol];
                  const canBuy = !held && Object.keys(portfolio.holdings).length < MAX_POSITIONS && portfolio.cash * POSITION_SIZE >= 10;
                  return (
                    <div key={symbol} className="px-4 py-2.5 flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-[100px]">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">{symbol}</span>
                          <SignalBadge signal={rs?.signal} />
                        </div>
                        <div className="text-[10px] text-[#484f58] mt-0.5">Score {rs?.score}/100</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-mono text-white">{formatPrice(price)}</div>
                      </div>
                      {held ? (
                        <span className="text-[10px] text-[#484f58] px-2 py-1 rounded bg-[#21262d]">Held</span>
                      ) : (
                        <button
                          onClick={() => manualBuy(symbol)}
                          disabled={!canBuy || !price}
                          className="px-3 py-1 rounded bg-green-500/15 border border-green-500/30 text-green-400 text-xs hover:bg-green-500/25 transition-colors disabled:opacity-30"
                        >
                          Buy 15%
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* AI Activity log */}
        {aiLog.length > 0 && (
          <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
            <div className="text-xs font-semibold text-[#484f58] uppercase tracking-widest mb-2">AI Activity</div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {aiLog.map((entry, i) => (
                <div key={i} className="text-[11px] text-[#8b949e] font-mono">{entry.msg}</div>
              ))}
            </div>
          </div>
        )}

        {/* Trade history */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#30363d]">
            <div className="text-sm font-semibold text-white">Trade History ({portfolio.trades.length})</div>
          </div>
          {portfolio.trades.length === 0 ? (
            <div className="px-4 py-6 text-center text-[#484f58] text-sm">No trades yet.</div>
          ) : (
            <div className="divide-y divide-[#30363d] max-h-72 overflow-y-auto">
              {portfolio.trades.slice(0, 50).map((t, i) => (
                <div key={t.id ?? i} className="px-4 py-2.5 flex items-center gap-3">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.side === 'BUY' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                    {t.side}
                  </span>
                  <span className="text-sm font-semibold text-white w-12">{t.symbol}</span>
                  <span className="text-[11px] text-[#8b949e] font-mono">{formatPrice(t.price)}</span>
                  {t.gainLoss != null && (
                    <span className={`text-[11px] font-mono ml-auto ${t.gainLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {t.gainLoss >= 0 ? '+' : ''}{formatUSD(t.gainLoss)}
                    </span>
                  )}
                  <span className="text-[10px] text-[#484f58] hidden sm:block truncate max-w-[160px]">{t.reason}</span>
                  <span className="text-[10px] text-[#484f58] ml-auto sm:ml-0">
                    {new Date(t.time).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}

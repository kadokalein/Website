import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { createCoinbaseClient } from '../lib/coinbaseApi';
import { fetchCandles } from '../utils/binanceApi';
import { analyzeCandles } from '../utils/indicators';
import { computeRunScore } from '../utils/scoring';
import { SCAN_UNIVERSE } from '../constants';

const KEY_STORAGE   = 'pp_cb_keys_v1';
const STATE_STORAGE = 'pp_live_state_v1';
const POSITION_SIZE = 0.15;
const STOP_LOSS     = -0.05;
const TAKE_PROFIT   =  0.08;
const EXIT_SCORE    = 25;
const MAX_POSITIONS = 4;
const PRICE_REFRESH = 90_000; // 90s between price checks

function loadKeys() {
  try { return JSON.parse(localStorage.getItem(KEY_STORAGE) ?? 'null'); } catch { return null; }
}
function saveKeys(k) {
  try { localStorage.setItem(KEY_STORAGE, JSON.stringify(k)); } catch { /* */ }
}
function loadLiveState() {
  try { return JSON.parse(localStorage.getItem(STATE_STORAGE) ?? 'null'); } catch { return null; }
}
function saveLiveState(s) {
  try { localStorage.setItem(STATE_STORAGE, JSON.stringify(s)); } catch { /* */ }
}

function formatUSD(v) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v ?? 0);
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
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cfg}`}>{signal}</span>;
}

export default function LiveTrading() {
  const [keys, setKeys]           = useState(() => loadKeys());
  const [keyInput, setKeyInput]   = useState({ apiKey: '', apiSecret: '' });
  const [showSetup, setShowSetup] = useState(!loadKeys());
  const [accounts, setAccounts]   = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError]     = useState(null);

  const [prices, setPrices]   = useState({});
  const [scores, setScores]   = useState({});
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoLog, setAutoLog] = useState([]);
  const [livePositions, setLivePositions] = useState(() => loadLiveState()?.positions ?? {});
  const [liveOrders, setLiveOrders]       = useState([]);
  const [refreshing, setRefreshing]       = useState(false);
  const [actionStatus, setActionStatus]   = useState(null); // { msg, ok }

  const autoRef = useRef(autoEnabled);
  autoRef.current = autoEnabled;

  const client = keys ? createCoinbaseClient(keys.apiKey, keys.apiSecret) : null;

  // Persist live positions
  useEffect(() => {
    saveLiveState({ positions: livePositions });
  }, [livePositions]);

  const setStatus = (msg, ok = true) => {
    setActionStatus({ msg, ok });
    setTimeout(() => setActionStatus(null), 5000);
  };

  // Save keys
  function handleSaveKeys(e) {
    e.preventDefault();
    const trimmed = { apiKey: keyInput.apiKey.trim(), apiSecret: keyInput.apiSecret.trim() };
    if (!trimmed.apiKey || !trimmed.apiSecret) return;
    saveKeys(trimmed);
    setKeys(trimmed);
    setShowSetup(false);
    setStatus('API keys saved to localStorage (never sent to any server other than api.coinbase.com)');
  }

  function handleClearKeys() {
    if (!confirm('Remove Coinbase API keys from this browser?')) return;
    localStorage.removeItem(KEY_STORAGE);
    setKeys(null);
    setShowSetup(true);
    setAutoEnabled(false);
    setAccounts([]);
  }

  // Fetch Coinbase account balances
  const fetchAccounts = useCallback(async () => {
    if (!client) return;
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const data = await client.getAccounts();
      const relevant = (data.accounts ?? [])
        .filter(a => parseFloat(a.available_balance?.value ?? 0) > 0)
        .sort((a, b) => parseFloat(b.available_balance?.value ?? 0) - parseFloat(a.available_balance?.value ?? 0));
      setAccounts(relevant);
    } catch (e) {
      setAccountsError(e.message);
    } finally {
      setAccountsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (keys && !showSetup) fetchAccounts();
  }, [keys, showSetup]);

  // Fetch recent orders from Coinbase
  const fetchOrders = useCallback(async () => {
    if (!client) return;
    try {
      const data = await client.listOrders({ limit: 20 });
      setLiveOrders(data.orders ?? []);
    } catch { /* silent */ }
  }, [client]);

  // Price/score refresh
  const refreshPrices = useCallback(async () => {
    setRefreshing(true);
    const symbols = new Set([
      ...Object.keys(livePositions),
      ...SCAN_UNIVERSE.slice(0, 15).map(c => c.symbol),
    ]);
    const fp = {}, fs = {};
    await Promise.allSettled([...symbols].map(async symbol => {
      try {
        const { candles, interval } = await fetchCandles(symbol, '4H');
        const analysis = analyzeCandles(candles, interval);
        fp[symbol] = analysis.currentPrice;
        fs[symbol] = computeRunScore(analysis);
      } catch { /* */ }
    }));
    setPrices(p => ({ ...p, ...fp }));
    setScores(p => ({ ...p, ...fs }));
    setRefreshing(false);
    return { freshPrices: fp, freshScores: fs };
  }, [livePositions]);

  // AI auto-trade engine (REAL MONEY)
  const runAI = useCallback(async (freshPrices, freshScores) => {
    if (!autoRef.current || !client) return;
    const log = [];
    const now = new Date().toISOString();

    // Check exits
    for (const [symbol, pos] of Object.entries(livePositions)) {
      const price = freshPrices[symbol] ?? prices[symbol];
      if (!price) continue;
      const pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
      const score  = freshScores[symbol]?.score ?? 0;
      let reason = null;
      if (pnlPct <= STOP_LOSS * 100)   reason = `Stop loss ${pnlPct.toFixed(1)}%`;
      else if (pnlPct >= TAKE_PROFIT * 100) reason = `Take profit +${pnlPct.toFixed(1)}%`;
      else if (score < EXIT_SCORE)          reason = `Score dropped to ${score}`;

      if (reason) {
        try {
          const orderId = `live-sell-${symbol}-${Date.now()}`;
          await client.placeMarketSell(orderId, `${symbol}-USDC`, String(parseFloat(pos.qty.toFixed(8))));
          setLivePositions(p => { const n = { ...p }; delete n[symbol]; return n; });
          log.push(`SOLD ${symbol}: ${reason}`);
          setStatus(`SOLD ${symbol} — ${reason}`, true);
        } catch (e) {
          log.push(`SELL ${symbol} FAILED: ${e.message}`);
          setStatus(`Sell ${symbol} failed: ${e.message}`, false);
        }
      }
    }

    // Check entries
    const openPositions = Object.keys(livePositions).length;
    if (openPositions < MAX_POSITIONS) {
      // Find USD/USDC balance from accounts
      const usdAccount = accounts.find(a =>
        a.currency === 'USD' || a.currency === 'USDC' || a.currency === 'USDT'
      );
      const availableCash = parseFloat(usdAccount?.available_balance?.value ?? 0);
      const spend = availableCash * POSITION_SIZE;

      if (spend >= 5) {
        const candidates = Object.entries(freshScores)
          .filter(([sym, rs]) => rs?.signal === 'BUY TRIGGERED' && !livePositions[sym] && (freshPrices[sym] ?? 0) > 0)
          .sort((a, b) => (b[1]?.score ?? 0) - (a[1]?.score ?? 0));

        for (const [symbol, rs] of candidates) {
          if (Object.keys(livePositions).length >= MAX_POSITIONS) break;
          try {
            const orderId = `live-buy-${symbol}-${Date.now()}`;
            await client.placeMarketBuy(orderId, `${symbol}-USDC`, String(spend.toFixed(2)));
            const price = freshPrices[symbol];
            const qty = spend / price;
            setLivePositions(p => ({
              ...p,
              [symbol]: { qty, entryPrice: price, entryTime: now, entryScore: rs?.score ?? 0 },
            }));
            log.push(`BOUGHT ${symbol} ~${formatUSD(spend)} — Score ${rs?.score}`);
            setStatus(`BUY order placed: ${symbol} (${formatUSD(spend)})`, true);
          } catch (e) {
            log.push(`BUY ${symbol} FAILED: ${e.message}`);
            setStatus(`Buy ${symbol} failed: ${e.message}`, false);
          }
        }
      }
    }

    if (log.length) {
      setAutoLog(prev => [...log.map(m => ({ msg: m, time: now })), ...prev].slice(0, 30));
      fetchAccounts();
      fetchOrders();
    }
  }, [client, livePositions, prices, accounts, fetchAccounts, fetchOrders]);

  // Periodic refresh
  useEffect(() => {
    if (!keys) return;
    const timer = setInterval(async () => {
      const { freshPrices, freshScores } = await refreshPrices();
      if (autoRef.current) runAI(freshPrices, freshScores);
    }, PRICE_REFRESH);
    return () => clearInterval(timer);
  }, [keys, refreshPrices, runAI]);

  // Initial load
  useEffect(() => {
    if (keys) { refreshPrices(); fetchOrders(); }
  }, []);

  // Manual place market buy
  async function manualBuy(symbol) {
    if (!client) return;
    const usdAccount = accounts.find(a => a.currency === 'USD' || a.currency === 'USDC');
    const cash = parseFloat(usdAccount?.available_balance?.value ?? 0);
    const spend = cash * POSITION_SIZE;
    if (spend < 5) { setStatus('Insufficient balance (need ≥ $5)', false); return; }
    try {
      const orderId = `manual-buy-${symbol}-${Date.now()}`;
      await client.placeMarketBuy(orderId, `${symbol}-USDC`, String(spend.toFixed(2)));
      const price = prices[symbol];
      if (price) {
        setLivePositions(p => ({
          ...p,
          [symbol]: { qty: spend / price, entryPrice: price, entryTime: new Date().toISOString(), entryScore: scores[symbol]?.score ?? 0 },
        }));
      }
      setStatus(`BUY order placed: ${symbol}`, true);
      fetchAccounts(); fetchOrders();
    } catch (e) {
      setStatus(`Buy failed: ${e.message}`, false);
    }
  }

  async function manualSell(symbol) {
    if (!client) return;
    const pos = livePositions[symbol];
    if (!pos) return;
    try {
      const orderId = `manual-sell-${symbol}-${Date.now()}`;
      await client.placeMarketSell(orderId, `${symbol}-USDC`, String(parseFloat(pos.qty.toFixed(8))));
      setLivePositions(p => { const n = { ...p }; delete n[symbol]; return n; });
      setStatus(`SELL order placed: ${symbol}`, true);
      fetchAccounts(); fetchOrders();
    } catch (e) {
      setStatus(`Sell failed: ${e.message}`, false);
    }
  }

  const usdBalance = accounts.find(a => a.currency === 'USD' || a.currency === 'USDC' || a.currency === 'USDT');

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <header className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117]/95 backdrop-blur px-4 sm:px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/Website/logo.svg" alt="" className="w-6 h-6 rounded-full flex-shrink-0 hidden sm:block" />
            <Link to="/" className="text-[#8b949e] hover:text-white transition-colors text-sm">← Dashboard</Link>
            <span className="text-[#30363d]">|</span>
            <span className="font-semibold text-white text-sm">Live Trading</span>
            <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-400 text-[10px] font-semibold border border-red-500/30">REAL MONEY</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshPrices().then(({ freshPrices, freshScores }) => runAI(freshPrices, freshScores))}
              disabled={refreshing || !keys}
              className="px-3 py-1.5 rounded-md text-xs bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white transition-colors disabled:opacity-40"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <Link to="/paper" className="px-3 py-1.5 rounded-md text-xs bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 transition-colors">
              Paper Trading
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Warning banner */}
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 flex gap-3">
          <span className="text-red-400 text-lg flex-shrink-0">⚠</span>
          <div className="text-sm text-red-300">
            <strong>This page places real orders on Coinbase using your API key.</strong> Only enable auto-trading with money you can afford to lose.
            Your API keys are stored in <em>this browser's localStorage only</em> and are never sent to any server other than <code className="text-red-200">api.coinbase.com</code>.
          </div>
        </div>

        {/* API Key setup */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-white">Coinbase API Keys</div>
              <div className="text-[10px] text-[#484f58] mt-0.5">Create a read+trade scoped key at coinbase.com → Settings → API</div>
            </div>
            {keys && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-green-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" /> Keys saved
                </span>
                <button onClick={() => setShowSetup(s => !s)} className="text-xs text-[#8b949e] hover:text-white px-2 py-1 rounded border border-[#30363d]">
                  {showSetup ? 'Hide' : 'Edit'}
                </button>
                <button onClick={handleClearKeys} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-500/30">
                  Remove
                </button>
              </div>
            )}
          </div>

          {showSetup && (
            <form onSubmit={handleSaveKeys} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                placeholder="API Key"
                value={keyInput.apiKey}
                onChange={e => setKeyInput(p => ({ ...p, apiKey: e.target.value }))}
                className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-1.5 text-sm text-white placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff]"
              />
              <input
                type="password"
                placeholder="API Secret"
                value={keyInput.apiSecret}
                onChange={e => setKeyInput(p => ({ ...p, apiSecret: e.target.value }))}
                className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-1.5 text-sm text-white placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff]"
              />
              <button type="submit" className="px-4 py-1.5 rounded-md bg-[#1f6feb] hover:bg-[#388bfd] text-white text-sm font-medium transition-colors">
                Save Keys
              </button>
            </form>
          )}
        </div>

        {/* Status toast */}
        {actionStatus && (
          <div className={`rounded-lg px-4 py-2 text-sm font-medium ${actionStatus.ok ? 'bg-green-500/15 text-green-300 border border-green-500/30' : 'bg-red-500/15 text-red-400 border border-red-500/30'}`}>
            {actionStatus.msg}
          </div>
        )}

        {keys && (
          <>
            {/* Account balances */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-white">Account Balances</div>
                <button onClick={fetchAccounts} disabled={accountsLoading} className="text-xs text-[#8b949e] hover:text-white px-2 py-1 rounded border border-[#30363d] disabled:opacity-40">
                  {accountsLoading ? '…' : 'Refresh'}
                </button>
              </div>
              {accountsError ? (
                <div className="text-red-400 text-sm">{accountsError}</div>
              ) : accounts.length === 0 && !accountsLoading ? (
                <div className="text-[#484f58] text-sm">No balances found. Check your API key permissions.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {accounts.slice(0, 9).map(acc => (
                    <div key={acc.uuid} className="bg-[#0d1117] rounded-lg px-3 py-2">
                      <div className="text-xs font-semibold text-white">{acc.currency}</div>
                      <div className="text-sm font-mono text-[#58a6ff]">{parseFloat(acc.available_balance?.value ?? 0).toFixed(acc.currency === 'USD' || acc.currency === 'USDC' ? 2 : 6)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Auto-trading controls */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  AI Auto-Trading
                  {autoEnabled && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-orange-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse inline-block" />
                      LIVE — real orders
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-[#484f58] mt-0.5">
                  BUY TRIGGERED → 15% of cash · Stop {(STOP_LOSS*100).toFixed(0)}% · Target +{(TAKE_PROFIT*100).toFixed(0)}% · Max {MAX_POSITIONS} positions
                </div>
              </div>
              <button
                onClick={() => {
                  if (!autoEnabled) {
                    if (!confirm('Enable AI auto-trading with REAL money on Coinbase? The AI will place market orders automatically.')) return;
                  }
                  setAutoEnabled(v => !v);
                }}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  autoEnabled
                    ? 'bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25'
                    : 'bg-orange-500/15 border border-orange-500/30 text-orange-400 hover:bg-orange-500/25'
                }`}
              >
                {autoEnabled ? 'Stop AI' : 'Start AI'}
              </button>
            </div>

            {/* Tracked positions */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#30363d]">
                <div className="text-sm font-semibold text-white">Tracked Positions ({Object.keys(livePositions).length})</div>
                <div className="text-[10px] text-[#484f58] mt-0.5">Positions placed by this app — does not include orders placed elsewhere</div>
              </div>
              {Object.keys(livePositions).length === 0 ? (
                <div className="px-4 py-6 text-center text-[#484f58] text-sm">No tracked positions.</div>
              ) : (
                <div className="divide-y divide-[#30363d]">
                  {Object.entries(livePositions).map(([symbol, pos]) => {
                    const price = prices[symbol] ?? pos.entryPrice;
                    const pnlPctVal = ((price - pos.entryPrice) / pos.entryPrice) * 100;
                    const rs = scores[symbol];
                    return (
                      <div key={symbol} className="px-4 py-3 flex flex-wrap items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#21262d] flex items-center justify-center text-xs font-bold text-orange-400">
                          {symbol.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-[100px]">
                          <div className="text-sm font-semibold text-white">{symbol}</div>
                          <div className="text-[10px] text-[#484f58]">Entry {formatPrice(pos.entryPrice)} · Score {pos.entryScore}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-mono text-white">{formatPrice(price)}</div>
                          <div className={`text-[10px] font-mono ${pnlPctVal >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {pnlPctVal >= 0 ? '+' : ''}{pnlPctVal.toFixed(2)}%
                          </div>
                        </div>
                        {rs && <SignalBadge signal={rs.signal} />}
                        <button onClick={() => manualSell(symbol)} className="px-3 py-1 rounded bg-red-500/15 border border-red-500/30 text-red-400 text-xs hover:bg-red-500/25">
                          Sell
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Top signals */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#30363d]">
                <div className="text-sm font-semibold text-white">Top Signals</div>
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
                      const held = livePositions[symbol];
                      const canBuy = !held && Object.keys(livePositions).length < MAX_POSITIONS;
                      return (
                        <div key={symbol} className="px-4 py-2.5 flex flex-wrap items-center gap-3">
                          <div className="flex-1 min-w-[100px]">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-white">{symbol}</span>
                              <SignalBadge signal={rs?.signal} />
                            </div>
                            <div className="text-[10px] text-[#484f58]">Score {rs?.score}/100</div>
                          </div>
                          <div className="text-sm font-mono text-white">{formatPrice(prices[symbol])}</div>
                          {held ? (
                            <span className="text-[10px] text-[#484f58] px-2 py-1 rounded bg-[#21262d]">Held</span>
                          ) : (
                            <button
                              onClick={() => manualBuy(symbol)}
                              disabled={!canBuy || !prices[symbol]}
                              className="px-3 py-1 rounded bg-orange-500/15 border border-orange-500/30 text-orange-300 text-xs hover:bg-orange-500/25 disabled:opacity-30"
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

            {/* AI activity log */}
            {autoLog.length > 0 && (
              <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
                <div className="text-xs font-semibold text-[#484f58] uppercase tracking-widest mb-2">AI Activity</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {autoLog.map((entry, i) => (
                    <div key={i} className="text-[11px] text-[#8b949e] font-mono">{entry.msg}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Coinbase order history */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#30363d] flex items-center justify-between">
                <div className="text-sm font-semibold text-white">Coinbase Order History</div>
                <button onClick={fetchOrders} className="text-xs text-[#8b949e] hover:text-white px-2 py-1 rounded border border-[#30363d]">Refresh</button>
              </div>
              {liveOrders.length === 0 ? (
                <div className="px-4 py-6 text-center text-[#484f58] text-sm">No orders found.</div>
              ) : (
                <div className="divide-y divide-[#30363d] max-h-64 overflow-y-auto">
                  {liveOrders.map(order => {
                    const filled = parseFloat(order.filled_size ?? 0);
                    const avg    = parseFloat(order.average_filled_price ?? 0);
                    const total  = filled * avg;
                    const side   = order.side;
                    return (
                      <div key={order.order_id} className="px-4 py-2.5 flex items-center gap-3">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${side === 'BUY' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                          {side}
                        </span>
                        <span className="text-sm font-semibold text-white w-20">{order.product_id?.replace('-USDC','')}</span>
                        <span className="text-[11px] text-[#8b949e] font-mono">{avg > 0 ? formatPrice(avg) : '—'}</span>
                        <span className="text-[11px] text-[#8b949e] font-mono ml-auto">{total > 0 ? formatUSD(total) : '—'}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${order.status === 'FILLED' ? 'text-green-400' : 'text-[#484f58]'}`}>
                          {order.status}
                        </span>
                        <span className="text-[10px] text-[#484f58] hidden sm:block">
                          {order.created_time ? new Date(order.created_time).toLocaleTimeString() : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {!keys && (
          <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-8 text-center">
            <div className="text-[#484f58] text-4xl mb-3">🔑</div>
            <div className="text-white font-semibold mb-1">Enter your Coinbase API keys above to get started</div>
            <div className="text-[#8b949e] text-sm">Keys are stored only in your browser — never on any server</div>
          </div>
        )}

      </main>
    </div>
  );
}

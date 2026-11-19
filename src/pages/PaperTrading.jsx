import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { fetchCandles } from '../utils/binanceApi';
import { analyzeCandles } from '../utils/indicators';
import { computeRunScore } from '../utils/scoring';
import { fetchMarketData, capTier } from '../utils/coingeckoApi';
import { SCAN_UNIVERSE } from '../constants';

// ─── Constants ────────────────────────────────────────────────────────────────
const STORAGE_KEY   = 'pp_paper_v2';
const START_BALANCE = 5000;
const MAX_POSITIONS = 6;
const SCAN_INTERVAL = 3 * 60 * 1000;  // rescan every 3 min
const GECKO_TTL     = 10 * 60 * 1000; // CoinGecko cache 10 min
const CHURN_COOLDOWN = 4 * 3600_000;  // 4h before re-buying a coin just sold

// ─── Trading strategies ───────────────────────────────────────────────────────
const STRATEGIES = {
  MOMENTUM: { label: 'Momentum', size: 0.18, target: 0.08,  stop: -0.05,  maxDays: 14, color: 'text-green-400'  },
  BREAKOUT: { label: 'Breakout', size: 0.15, target: 0.06,  stop: -0.03,  maxDays:  5, color: 'text-orange-400' },
  SWING:    { label: 'Swing',    size: 0.12, target: 0.045, stop: -0.03,  maxDays:  7, color: 'text-blue-400'   },
  DIP:      { label: 'Dip',      size: 0.10, target: 0.04,  stop: -0.025, maxDays:  3, color: 'text-purple-400' },
  SCALP:    { label: 'Scalp',    size: 0.10, target: 0.025, stop: -0.015, maxDays:  1, color: 'text-yellow-400' },
};

// Pick which strategy applies to this coin, returns null if no entry.
//
// Entry hierarchy (most selective → most frequent):
//   1. MOMENTUM  — scanner "BUY TRIGGERED" (high score, volume spike, state change)
//   2. BREAKOUT  — price closes above 20-bar prior high with volume (classic breakout)
//   3. DIP       — Stochastic RSI < 25 with K crossing above D (FreqTrade-style mean-reversion)
//   4. SWING A   — WATCH signal from scanner in uptrend context
//   5. SWING B   — EMA20 > EMA50 golden-cross dip, MACD bullish
//   6. SCALP     — 3-of-4 RSI/BB conditions, lowest bar
//
// EMA50 guard: blocks all entries when coin is > 6% below EMA50 (structural downtrend).
function pickStrategy(rs, analysis, gecko) {
  if (!rs || !analysis) return null;
  const { rsi, rsiTrend, macd, bb, currentPrice, ema20, ema50, emaTrend, stochRSI, prevRecentHigh, volume } = analysis;
  const change7d = gecko?.change7d ?? 0;

  // EMA50 structural guard — block entries in structural downtrends
  const ema50Ok = ema50 == null || currentPrice == null || currentPrice >= ema50 * 0.94;

  // 1. MOMENTUM — scanner confirmed buy
  if (rs.signal === 'BUY TRIGGERED') {
    if (change7d < -15 || !ema50Ok) return null;
    return { ...STRATEGIES.MOMENTUM, reason: rs.triggerReason ?? `Score ${rs.score}` };
  }

  // 2. BREAKOUT — close above 20-bar prior high with volume (trend-following breakout)
  const isBreakingOut = prevRecentHigh != null && currentPrice != null
    && currentPrice > prevRecentHigh * 1.005
    && (volume?.ratio ?? 0) >= 1.3;
  if (isBreakingOut && ema50Ok && rs.score >= 20) {
    return { ...STRATEGIES.BREAKOUT, reason: `Breakout · Vol ${(volume.ratio).toFixed(1)}x · Score ${rs.score}` };
  }

  // 3. DIP — Stochastic RSI oversold bounce (fires 3–5× more than plain RSI oversold)
  // Best mean-reversion strategy in ranging/dipping markets. Used in Freqtrade, Jesse, etc.
  const stochOversold  = stochRSI?.k != null && stochRSI.k < 25;
  const stochMomentum  = stochRSI?.bullishCross || (stochRSI?.k != null && stochRSI?.d != null && stochRSI.k > stochRSI.d);
  if (stochOversold && stochMomentum && ema50Ok && rs.score >= 10) {
    const reason = `StochRSI K=${stochRSI.k.toFixed(0)}${stochRSI.bullishCross ? '↑cross' : '↑'} · Score ${rs.score}`;
    return { ...STRATEGIES.DIP, reason };
  }

  // 4. SWING path A — mean-reversion on WATCH signal
  if (rs.signal === 'WATCH' && ema50Ok) {
    const weeklyOk = change7d > -8;
    if (weeklyOk || rs.score >= 65) {
      const reason = `WATCH (score ${rs.score})` + (gecko?.change7d != null
        ? ` · 7d ${gecko.change7d >= 0 ? '+' : ''}${gecko.change7d.toFixed(1)}%` : '');
      return { ...STRATEGIES.SWING, reason };
    }
  }

  // 5. SWING path B — EMA golden-cross dip: EMA20 > EMA50, price dips to EMA20, MACD bullish
  if (emaTrend === 'up' && ema50Ok && ema20 != null && currentPrice != null
      && currentPrice >= ema20 * 0.97 && currentPrice <= ema50 * 1.25
      && macd?.status === 'bullish' && rs.score >= 30) {
    return { ...STRATEGIES.SWING, reason: `EMA cross dip · MACD bull · Score ${rs.score}` };
  }

  // 6. SCALP — 3-of-4 RSI/BB conditions (lowest bar, fires most often)
  const nearLower    = bb?.lower != null && currentPrice != null && currentPrice <= bb.lower * 1.04;
  const deepOversold = rsi != null && rsi < 42;
  const rsiCurling   = rsiTrend === 'rising';
  const macdOk       = macd?.isBullishCrossover
    || macd?.status === 'bullish'
    || (macd?.isHistogramRising && macd?.histogram != null && macd.histogram > -0.002 * (currentPrice ?? 1));
  const weeklyOk     = change7d > -8;

  const scalp3of4 = [nearLower, deepOversold, rsiCurling || macdOk, weeklyOk].filter(Boolean).length >= 3;
  if (scalp3of4 && ema50Ok && rs.score >= 15) {
    const reason = `RSI ${rsi != null ? rsi.toFixed(1) : '?'}${rsiCurling ? '↑' : ''}`
      + (nearLower ? ' BB↓' : '') + (macd?.isBullishCrossover ? ' MACD↑' : '');
    return { ...STRATEGIES.SCALP, reason };
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'); } catch { return null; }
}
function saveState(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* */ }
}
function fresh() {
  return { cash: START_BALANCE, startBalance: START_BALANCE, holdings: {}, trades: [], autoEnabled: false, lastSoldAt: {} };
}

function formatUSD(v) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v ?? 0);
}
function formatPrice(p) {
  if (p == null) return '—';
  if (p >= 1000) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(p);
  if (p >= 1)    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(p);
}
function pct(v, d = 1) { if (v == null) return '—'; return `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`; }

// ─── Sub-components ───────────────────────────────────────────────────────────
function SignalBadge({ signal }) {
  const s = {
    'BUY TRIGGERED': 'bg-green-500/15 text-green-300 border-green-500/30',
    'WATCH':         'bg-yellow-500/10 text-yellow-400 border-yellow-500/25',
    'LOW QUALITY':   'bg-blue-500/10 text-blue-400 border-blue-500/25',
    'NO SIGNAL':     'bg-[#21262d] text-[#484f58] border-[#30363d]',
  }[signal] ?? 'bg-[#21262d] text-[#484f58] border-[#30363d]';
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${s}`}>{signal ?? '—'}</span>;
}

function StratBadge({ strat }) {
  if (!strat) return null;
  const s = STRATEGIES[strat];
  return <span className={`text-[10px] font-semibold ${s?.color}`}>{s?.label}</span>;
}

function PnlPill({ pnl }) {
  const color = pnl >= 0 ? 'text-green-400' : 'text-red-400';
  return <span className={`font-mono text-[11px] ${color}`}>{pct(pnl)}</span>;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function PaperTrading() {
  const [portfolio, setPortfolio] = useState(() => loadState() ?? fresh());
  // enriched: symbol → { price, rs, rsi, macd, bb, volume, gecko }
  const [enriched, setEnriched]   = useState({});
  const [scanning, setScanning]   = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: SCAN_UNIVERSE.length });
  const [geckoData, setGeckoData] = useState({});
  const geckoFetchedAt = useRef(0);
  const [aiLog, setAiLog]         = useState([]);
  const autoRef = useRef(false);
  autoRef.current = portfolio.autoEnabled;

  // Persist
  useEffect(() => { saveState(portfolio); }, [portfolio]);

  // ── Fetch CoinGecko market data (cached) ──────────────────────────────────
  const fetchGecko = useCallback(async () => {
    if (Date.now() - geckoFetchedAt.current < GECKO_TTL) return;
    try {
      const data = await fetchMarketData(SCAN_UNIVERSE.map(c => c.symbol));
      setGeckoData(data);
      geckoFetchedAt.current = Date.now();
    } catch { /* CoinGecko down — continue without */ }
  }, []);

  // ── Full scan of all 50 coins ─────────────────────────────────────────────
  const runScan = useCallback(async () => {
    setScanning(true);
    setScanProgress({ done: 0, total: SCAN_UNIVERSE.length });
    await fetchGecko();

    const result = {};
    const BATCH  = 5;

    for (let i = 0; i < SCAN_UNIVERSE.length; i += BATCH) {
      const batch = SCAN_UNIVERSE.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(async coin => {
        try {
          const { candles, interval } = await fetchCandles(coin.symbol, '4H');
          const analysis = analyzeCandles(candles, interval);
          const rs = computeRunScore(analysis);
          result[coin.symbol] = {
            price:         analysis.currentPrice,
            rs,
            rsi:           analysis.rsi,
            rsiTrend:      analysis.rsiTrend,
            roc:           analysis.roc,
            macd:          analysis.macd,
            bb:            analysis.bb,
            volume:        analysis.volume,
            atrPct:        analysis.atrPercentile,
            ema20:         analysis.ema20,
            ema50:         analysis.ema50,
            emaTrend:      analysis.emaTrend,
            stochRSI:      analysis.stochRSI,
            prevRecentHigh: analysis.prevRecentHigh,
          };
        } catch { /* skip failed coins */ }
      }));
      setScanProgress({ done: Math.min(i + BATCH, SCAN_UNIVERSE.length), total: SCAN_UNIVERSE.length });
      if (i + BATCH < SCAN_UNIVERSE.length) await new Promise(r => setTimeout(r, 200));
    }

    setEnriched(result);
    setScanning(false);
    return result;
  }, [fetchGecko]);

  // ── AI decision engine ────────────────────────────────────────────────────
  const runAI = useCallback((snapshot, gecko) => {
    if (!autoRef.current) return;
    const now = new Date().toISOString();
    const log = [];

    setPortfolio(prev => {
      const p = JSON.parse(JSON.stringify(prev));

      // — Update trailing stops & exits —
      for (const [sym, h] of Object.entries(p.holdings)) {
        const e = snapshot[sym];
        const price = e?.price;
        if (!price) continue;

        const pnlFrac  = (price - h.entryPrice) / h.entryPrice;
        const strat    = STRATEGIES[h.strategy] ?? STRATEGIES.SWING;

        // Trailing stop logic:
        //   • Once up 1 %: move stop to breakeven (never lose on a winner)
        //   • Once at 60 % of target: trail at half-stop-distance below current price
        if (pnlFrac >= 0.01) {
          const breakeven = h.entryPrice * 1.001;
          if (!h.trailingStop || h.trailingStop < breakeven) {
            h.trailingStop = breakeven;
          }
        }
        if (pnlFrac >= strat.target * 0.6) {
          const trailDist = Math.abs(strat.stop) * 0.5;
          const newTrail  = price * (1 - trailDist);
          if (!h.trailingStop || newTrail > h.trailingStop) {
            h.trailingStop = newTrail;
          }
        }
      }

      for (const [sym, h] of Object.entries(p.holdings)) {
        const e = snapshot[sym];
        const price = e?.price;
        if (!price) continue;

        const pnlFrac  = (price - h.entryPrice) / h.entryPrice;
        const pnlPct   = pnlFrac * 100;
        const daysHeld = (Date.now() - new Date(h.entryTime)) / 86_400_000;
        const rs    = e?.rs;
        const rsi   = e?.rsi;
        const strat = STRATEGIES[h.strategy] ?? STRATEGIES.SWING;
        let reason  = null;

        if (pnlFrac >= strat.target)                                       reason = `Take profit ${pct(pnlPct)}`;
        else if (h.trailingStop && price <= h.trailingStop)                reason = `Trailing stop ${pct(pnlPct)}`;
        else if (pnlFrac <= strat.stop)                                    reason = `Stop loss ${pct(pnlPct)}`;
        else if (daysHeld > strat.maxDays)                                 reason = `Time limit (${strat.maxDays}d)`;
        else if ((rs?.score ?? 0) < 20)                                    reason = `Score collapsed → ${rs?.score}`;
        else if (rsi != null && rsi > 72 && h.strategy !== 'MOMENTUM')    reason = `RSI overbought (${rsi.toFixed(0)})`;

        if (reason) {
          const proceeds = h.qty * price;
          const gainLoss = proceeds - h.qty * h.entryPrice;
          p.cash += proceeds;
          p.trades.unshift({ id: `${sym}-${Date.now()}`, sym, side: 'SELL', price, qty: h.qty, entryPrice: h.entryPrice, gainLoss, pnlPct, strategy: h.strategy, reason, time: now });
          delete p.holdings[sym];
          p.lastSoldAt = { ...(p.lastSoldAt ?? {}), [sym]: Date.now() };
          log.push({ type: gainLoss >= 0 ? 'win' : 'loss', msg: `SELL ${sym} · ${reason} · ${gainLoss >= 0 ? '+' : ''}${formatUSD(gainLoss)}` });
        }
      }

      // — Entries —
      const openCount = Object.keys(p.holdings).length;
      if (openCount < MAX_POSITIONS && p.cash >= 20) {
        // Score candidates and pick best non-held coins
        const candidates = Object.entries(snapshot)
          .filter(([sym]) => {
            if (p.holdings[sym]) return false;
            // Anti-churn: skip coins sold within the last 4 hours
            const lastSold = p.lastSoldAt?.[sym] ?? 0;
            return (Date.now() - lastSold) >= CHURN_COOLDOWN;
          })
          .map(([sym, e]) => {
            const strat = pickStrategy(e?.rs, { rsi: e?.rsi, rsiTrend: e?.rsiTrend, macd: e?.macd, bb: e?.bb, currentPrice: e?.price, volume: e?.volume, ema20: e?.ema20, ema50: e?.ema50, emaTrend: e?.emaTrend, stochRSI: e?.stochRSI, prevRecentHigh: e?.prevRecentHigh }, gecko?.[sym]);
            return { sym, e, strat };
          })
          .filter(c => c.strat !== null)
          // Sort: Momentum > Swing > Scalp, then by score
          .sort((a, b) => {
            const order = { MOMENTUM: 0, SWING: 1, SCALP: 2 };
            const ao = order[a.strat.label?.toUpperCase()] ?? 3;
            const bo = order[b.strat.label?.toUpperCase()] ?? 3;
            if (ao !== bo) return ao - bo;
            return (b.e?.rs?.score ?? 0) - (a.e?.rs?.score ?? 0);
          });

        let slots = MAX_POSITIONS - openCount;
        for (const { sym, e, strat } of candidates) {
          if (slots <= 0) break;
          const price = e?.price;
          if (!price) continue;
          const spend = p.cash * strat.size;
          if (spend < 10 || p.cash - spend < 10) continue;

          const qty = spend / price;
          const maxDaysDate = new Date(Date.now() + strat.maxDays * 86_400_000).toISOString();
          p.cash -= spend;
          p.holdings[sym] = {
            qty,
            entryPrice: price,
            entryTime: now,
            entryScore: e?.rs?.score ?? 0,
            strategy: Object.keys(STRATEGIES).find(k => STRATEGIES[k].label === strat.label) ?? 'SWING',
            target: strat.target,
            stop: strat.stop,
            maxDaysDate,
          };
          p.trades.unshift({ id: `${sym}-${Date.now()}-B`, sym, side: 'BUY', price, qty, strategy: strat.label, reason: strat.reason, time: now });
          log.push({ type: 'buy', msg: `BUY ${sym} @ ${formatPrice(price)} · ${strat.label} · ${strat.reason}` });
          slots--;
        }
      }

      if (log.length) p.lastAutoAt = now;
      return p;
    });

    if (log.length) {
      setAiLog(prev => [...log.map(l => ({ ...l, time: now })), ...prev].slice(0, 40));
    }
  }, []);

  // ── Periodic scan + AI loop ───────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    async function loop() {
      const snap = await runScan();
      if (alive) runAI(snap, geckoData);
    }
    loop();
    const timer = setInterval(loop, SCAN_INTERVAL);
    return () => { alive = false; clearInterval(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run AI whenever autoEnabled flips on (after prices already loaded)
  const prevAuto = useRef(portfolio.autoEnabled);
  useEffect(() => {
    if (portfolio.autoEnabled && !prevAuto.current && Object.keys(enriched).length > 0) {
      runAI(enriched, geckoData);
    }
    prevAuto.current = portfolio.autoEnabled;
  }, [portfolio.autoEnabled, enriched, geckoData, runAI]);

  function manualBuy(sym, strat) {
    const e = enriched[sym];
    if (!e?.price) return;
    const s = strat ?? STRATEGIES.SWING;
    const spend = portfolio.cash * s.size;
    if (spend < 10) return;
    const now = new Date().toISOString();
    setPortfolio(prev => {
      if (prev.holdings[sym] || Object.keys(prev.holdings).length >= MAX_POSITIONS) return prev;
      const qty = spend / e.price;
      return {
        ...prev,
        cash: prev.cash - spend,
        holdings: { ...prev.holdings, [sym]: { qty, entryPrice: e.price, entryTime: now, entryScore: e.rs?.score ?? 0, strategy: 'SWING', target: s.target, stop: s.stop, maxDaysDate: new Date(Date.now() + s.maxDays * 86_400_000).toISOString() } },
        trades: [{ id: `${sym}-${Date.now()}-MB`, sym, side: 'BUY', price: e.price, qty, strategy: 'Manual', reason: 'Manual', time: now }, ...prev.trades],
      };
    });
  }

  function manualSell(sym) {
    const price = enriched[sym]?.price ?? portfolio.holdings[sym]?.entryPrice;
    if (!price) return;
    setPortfolio(prev => {
      const h = prev.holdings[sym];
      if (!h) return prev;
      const proceeds = h.qty * price;
      const gainLoss = proceeds - h.qty * h.entryPrice;
      const pnlPct = ((price - h.entryPrice) / h.entryPrice) * 100;
      const newH = { ...prev.holdings };
      delete newH[sym];
      return {
        ...prev,
        cash: prev.cash + proceeds,
        holdings: newH,
        trades: [{ id: `${sym}-${Date.now()}-MS`, sym, side: 'SELL', price, qty: h.qty, entryPrice: h.entryPrice, gainLoss, pnlPct, strategy: h.strategy, reason: 'Manual', time: new Date().toISOString() }, ...prev.trades],
      };
    });
  }

  function reset() {
    if (!confirm('Reset all paper trades and positions?')) return;
    const f = fresh();
    setPortfolio(f);
    setAiLog([]);
    saveState(f);
  }

  // ── Computed stats ────────────────────────────────────────────────────────
  const holdingsValue = Object.entries(portfolio.holdings).reduce((s, [sym, h]) => {
    return s + h.qty * (enriched[sym]?.price ?? h.entryPrice);
  }, 0);
  const totalValue = portfolio.cash + holdingsValue;
  const totalPnl   = totalValue - portfolio.startBalance;
  const pnlPct_    = (totalPnl / portfolio.startBalance) * 100;
  const sells = portfolio.trades.filter(t => t.side === 'SELL');
  const wins  = sells.filter(t => (t.gainLoss ?? 0) > 0);
  const winRate = sells.length ? (wins.length / sells.length * 100).toFixed(0) : null;
  const totalWon  = wins.reduce((s, t) => s + (t.gainLoss ?? 0), 0);
  const totalLost = sells.filter(t => (t.gainLoss ?? 0) <= 0).reduce((s, t) => s + Math.abs(t.gainLoss ?? 0), 0);

  // Best signals to show
  const signalRows = Object.entries(enriched)
    .map(([sym, e]) => ({ sym, e, strat: pickStrategy(e?.rs, { rsi: e?.rsi, rsiTrend: e?.rsiTrend, macd: e?.macd, bb: e?.bb, currentPrice: e?.price, volume: e?.volume, ema20: e?.ema20, ema50: e?.ema50, emaTrend: e?.emaTrend }, geckoData[sym]), gecko: geckoData[sym] }))
    .filter(r => r.strat !== null || (r.e?.rs?.score ?? 0) >= 50)
    .sort((a, b) => {
      const order = { MOMENTUM: 0, SWING: 1, SCALP: 2 };
      const ao = a.strat ? (order[a.strat.label?.toUpperCase()] ?? 3) : 4;
      const bo = b.strat ? (order[b.strat.label?.toUpperCase()] ?? 3) : 4;
      if (ao !== bo) return ao - bo;
      return (b.e?.rs?.score ?? 0) - (a.e?.rs?.score ?? 0);
    })
    .slice(0, 12);

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">

      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117]/95 backdrop-blur px-4 sm:px-6 py-3">
        <div className="flex items-center gap-3">
          {/* Left: back link */}
          <div className="flex items-center gap-2 flex-shrink-0 w-28 sm:w-36">
            <img src="/Website/logo.svg" alt="" className="w-6 h-6 rounded-full hidden sm:block" />
            <Link to="/" className="text-[#8b949e] hover:text-white text-sm whitespace-nowrap">← Dashboard</Link>
          </div>

          {/* Center: page title */}
          <div className="flex-1 flex items-center justify-center gap-2">
            <span className="font-semibold text-sm text-white">Paper Trading</span>
            <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 text-[10px] font-semibold border border-blue-500/30">SIMULATED</span>
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2 flex-shrink-0 w-28 sm:w-36 justify-end">
            {scanning && (
              <div className="flex items-center gap-1.5 text-[10px] text-[#484f58]">
                <span className="w-2.5 h-2.5 border border-t-orange-400 border-orange-400/20 rounded-full animate-spin" />
                {scanProgress.done}/{scanProgress.total}
              </div>
            )}
            <button onClick={() => runScan().then(snap => runAI(snap, geckoData))} disabled={scanning}
              className="px-3 py-1.5 rounded-md text-xs bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white disabled:opacity-40">
              {scanning ? 'Scanning…' : 'Rescan'}
            </button>
            <Link to="/live" className="px-3 py-1.5 rounded-md text-xs bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/25">
              Live →
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Portfolio stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Portfolio Value', val: formatUSD(totalValue), sub: `${pct(pnlPct_)} all-time`, color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400' },
            { label: 'Cash Available', val: formatUSD(portfolio.cash), sub: `${((portfolio.cash/totalValue)*100).toFixed(0)}% idle`, color: 'text-white' },
            { label: 'Win Rate',        val: winRate ? `${winRate}%` : '—', sub: `${wins.length}W / ${sells.length - wins.length}L · ${sells.length} closed`, color: (winRate ?? 0) >= 50 ? 'text-green-400' : 'text-[#8b949e]' },
            { label: 'Total Gained',    val: formatUSD(totalWon), sub: `Lost ${formatUSD(totalLost)} · Net ${formatUSD(totalWon - totalLost)}`, color: 'text-green-400' },
          ].map(c => (
            <div key={c.label} className="rounded-xl border border-[#30363d] bg-[#161b22] p-3">
              <div className="text-[9px] text-[#484f58] font-semibold uppercase tracking-widest mb-1">{c.label}</div>
              <div className={`text-lg font-mono font-bold ${c.color}`}>{c.val}</div>
              <div className="text-[9px] text-[#484f58] mt-0.5">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Strategy legend */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] px-4 py-3">
          <div className="text-[10px] text-[#484f58] font-semibold uppercase tracking-widest mb-2">Trading Tiers (Goal: 2–3% / week)</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Object.entries(STRATEGIES).map(([key, s]) => (
              <div key={key} className="flex gap-2 items-start">
                <div className={`text-[10px] font-bold ${s.color} pt-0.5 w-16 flex-shrink-0`}>{s.label}</div>
                <div className="text-[10px] text-[#484f58] leading-relaxed">
                  Size {(s.size*100).toFixed(0)}% · Target +{(s.target*100).toFixed(1)}% · Stop {(s.stop*100).toFixed(0)}% · Max {s.maxDays}d
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* AI controls */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              AI Auto-Trading
              {portfolio.autoEnabled && (
                <span className="inline-flex items-center gap-1 text-[10px] text-green-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                  Active · scans every 5 min
                </span>
              )}
            </div>
            <div className="text-[10px] text-[#484f58] mt-0.5">
              Picks Scalp / Swing / Momentum based on RSI, MACD, BB, score, and 7-day trend from CoinGecko
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPortfolio(p => ({ ...p, autoEnabled: !p.autoEnabled }))}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${portfolio.autoEnabled
                ? 'bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25'
                : 'bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25'}`}>
              {portfolio.autoEnabled ? 'Stop AI' : 'Start AI'}
            </button>
            <button onClick={reset} className="px-3 py-1.5 rounded-lg text-xs bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-red-400">Reset</button>
          </div>
        </div>

        {/* Open positions */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#30363d]">
            <span className="text-sm font-semibold">Open Positions ({Object.keys(portfolio.holdings).length}/{MAX_POSITIONS})</span>
          </div>
          {Object.keys(portfolio.holdings).length === 0 ? (
            <div className="px-4 py-8 text-center text-[#484f58] text-sm">
              {portfolio.autoEnabled ? 'AI is scanning for entries…' : 'Enable AI or buy manually from signals below.'}
            </div>
          ) : (
            <div className="divide-y divide-[#30363d]">
              {Object.entries(portfolio.holdings).map(([sym, h]) => {
                const e = enriched[sym];
                const price = e?.price ?? h.entryPrice;
                const pnlF = (price - h.entryPrice) / h.entryPrice;
                const pnlP = pnlF * 100;
                const daysHeld = ((Date.now() - new Date(h.entryTime)) / 86_400_000).toFixed(1);
                const strat = STRATEGIES[h.strategy] ?? STRATEGIES.SWING;
                const targetPx = h.entryPrice * (1 + strat.target);
                const stopPx   = h.entryPrice * (1 + strat.stop);
                const gecko = geckoData[sym];
                return (
                  <div key={sym} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#21262d] flex items-center justify-center text-xs font-bold text-[#58a6ff]">
                        {sym.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-[100px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold">{sym}</span>
                          <StratBadge strat={h.strategy} />
                          {e?.rs && <SignalBadge signal={e.rs.signal} />}
                        </div>
                        <div className="text-[10px] text-[#484f58] mt-0.5">
                          Entry {formatPrice(h.entryPrice)} · {daysHeld}d held · Score {h.entryScore}
                          {gecko?.change7d != null && <span> · 7d {pct(gecko.change7d)}</span>}
                          {e?.emaTrend && <span className={e.emaTrend === 'up' ? 'text-green-500/70' : 'text-red-500/70'}> · EMA {e.emaTrend === 'up' ? '↑' : '↓'}</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-mono font-bold">{formatPrice(price)}</div>
                        <PnlPill pnl={pnlP} />
                        <span className="text-[#484f58] text-[10px]"> · {formatUSD(h.qty * price)}</span>
                      </div>
                      <button onClick={() => manualSell(sym)} className="px-3 py-1 rounded bg-red-500/15 border border-red-500/30 text-red-400 text-xs hover:bg-red-500/25">
                        Sell
                      </button>
                    </div>
                    {/* Mini progress bar to target/stop */}
                    <div className="mt-2 flex items-center gap-2 text-[9px] text-[#484f58]">
                      <span>Stop {formatPrice(stopPx)}</span>
                      <div className="flex-1 h-1 bg-[#30363d] rounded-full overflow-hidden relative">
                        <div className="absolute inset-y-0 left-0 bg-green-500/30 rounded-full" style={{ width: `${Math.min(100, Math.max(0, ((price - stopPx) / (targetPx - stopPx)) * 100))}%` }} />
                        <div className="absolute inset-y-0 bg-white/30 w-px" style={{ left: `${Math.min(100, Math.max(0, ((price - stopPx) / (targetPx - stopPx)) * 100))}%` }} />
                      </div>
                      <span>Target {formatPrice(targetPx)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Signal scanner */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#30363d]">
            <div className="text-sm font-semibold">
              {scanning ? `Scanning coins… ${scanProgress.done}/${scanProgress.total}` : `Signal Scanner (${signalRows.length} opportunities)`}
            </div>
            <div className="text-[10px] text-[#484f58] mt-0.5">Live market data · CoinGecko 7d trend · 4H scoring</div>
          </div>

          {scanning && signalRows.length === 0 ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 bg-[#21262d] rounded animate-pulse" />)}
            </div>
          ) : signalRows.length === 0 ? (
            <div className="px-4 py-8 text-center text-[#484f58] text-sm">No opportunities found yet. Market may be quiet — AI will keep scanning.</div>
          ) : (
            <div className="divide-y divide-[#30363d]">
              {signalRows.map(({ sym, e, strat, gecko }) => {
                const held = portfolio.holdings[sym];
                const canBuy = !held && Object.keys(portfolio.holdings).length < MAX_POSITIONS && portfolio.cash * (strat?.size ?? 0.1) >= 10;
                const tier = capTier(gecko?.marketCap);

                return (
                  <div key={sym} className="px-4 py-2.5 flex flex-wrap items-center gap-3">
                    {/* Coin info */}
                    <div className="flex-1 min-w-[130px]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold">{sym}</span>
                        {strat && <StratBadge strat={Object.keys(STRATEGIES).find(k => STRATEGIES[k].label === strat.label)} />}
                        {e?.rs && <SignalBadge signal={e.rs.signal} />}
                      </div>
                      <div className="text-[9px] text-[#484f58] mt-0.5 leading-relaxed">
                        Score {e?.rs?.score ?? 0}/100 · RSI {e?.rsi?.toFixed(0) ?? '—'}
                        {e?.macd && <span> · MACD {e.macd.status}{e.macd.isBullishCrossover ? ' ↑' : ''}</span>}
                        {e?.emaTrend && <span className={e.emaTrend === 'up' ? 'text-green-500/70' : 'text-red-500/70'}> · EMA {e.emaTrend === 'up' ? '↑' : '↓'}</span>}
                        {gecko && <span> · {tier} cap</span>}
                        {strat && <span className="text-[#6e7681]"> · {strat.reason}</span>}
                      </div>
                    </div>

                    {/* Price + 7d */}
                    <div className="text-right min-w-[70px]">
                      <div className="text-sm font-mono">{formatPrice(e?.price)}</div>
                      {gecko?.change7d != null && (
                        <div className={`text-[10px] font-mono ${gecko.change7d >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {pct(gecko.change7d, 1)} 7d
                        </div>
                      )}
                    </div>

                    {/* ATH context */}
                    {gecko?.athChangePct != null && (
                      <div className="text-[9px] text-[#484f58] hidden sm:block text-right min-w-[60px]">
                        <div>{pct(gecko.athChangePct, 0)} ATH</div>
                        <div>#{gecko.marketCapRank}</div>
                      </div>
                    )}

                    {/* Score bar */}
                    <div className="hidden sm:block w-20">
                      <div className="h-1 bg-[#30363d] rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-green-500"
                          style={{ width: `${e?.rs?.score ?? 0}%` }} />
                      </div>
                      <div className="text-[9px] text-[#484f58] mt-0.5 text-center">{e?.rs?.score ?? 0}/100</div>
                    </div>

                    {/* Action */}
                    {held ? (
                      <span className="text-[10px] text-[#484f58] px-2 py-1 rounded bg-[#21262d]">Held</span>
                    ) : strat ? (
                      <button onClick={() => manualBuy(sym, strat)} disabled={!canBuy}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-30 ${
                          strat.label === 'Momentum' ? 'bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25' :
                          strat.label === 'Swing' ? 'bg-blue-500/15 border border-blue-500/30 text-blue-400 hover:bg-blue-500/25' :
                          'bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/25'
                        }`}>
                        {strat.label} {(strat.size*100).toFixed(0)}%
                      </button>
                    ) : (
                      <button onClick={() => manualBuy(sym, STRATEGIES.SWING)} disabled={!canBuy}
                        className="px-3 py-1 rounded bg-[#21262d] border border-[#30363d] text-[#8b949e] text-xs hover:text-white disabled:opacity-30">
                        Watch
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* AI log */}
        {aiLog.length > 0 && (
          <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
            <div className="text-[10px] text-[#484f58] font-semibold uppercase tracking-widest mb-2">AI Decision Log</div>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {aiLog.map((entry, i) => (
                <div key={i} className={`text-[11px] font-mono ${entry.type === 'win' ? 'text-green-400' : entry.type === 'loss' ? 'text-red-400' : entry.type === 'buy' ? 'text-blue-400' : 'text-[#8b949e]'}`}>
                  {new Date(entry.time).toLocaleTimeString()} — {entry.msg}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trade history */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#30363d]">
            <span className="text-sm font-semibold">Trade History ({portfolio.trades.length})</span>
          </div>
          {portfolio.trades.length === 0 ? (
            <div className="px-4 py-6 text-center text-[#484f58] text-sm">No trades yet — start the AI or buy manually.</div>
          ) : (
            <div className="divide-y divide-[#30363d] max-h-80 overflow-y-auto">
              {portfolio.trades.slice(0, 60).map((t, i) => (
                <div key={t.id ?? i} className="px-4 py-2 flex items-center gap-2 text-[11px]">
                  <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${t.side === 'BUY' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>{t.side}</span>
                  <span className="font-semibold w-10">{t.sym}</span>
                  <span className="text-[#8b949e] font-mono">{formatPrice(t.price)}</span>
                  {t.strategy && <span className="text-[#484f58] hidden sm:block">{t.strategy}</span>}
                  {t.gainLoss != null && (
                    <span className={`font-mono ml-auto ${t.gainLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {t.gainLoss >= 0 ? '+' : ''}{formatUSD(t.gainLoss)} ({pct(t.pnlPct)})
                    </span>
                  )}
                  <span className="text-[#484f58] hidden sm:block truncate max-w-[150px] ml-auto sm:ml-0">{t.reason}</span>
                  <span className="text-[#484f58] text-[9px]">{new Date(t.time).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}

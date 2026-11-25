// Runs the Trading Desk for as long as any page of the site is open, and shares
// its state with every page. All state lives in this browser (localStorage).
//
// One run ("tick") every few minutes covers crypto and every enabled stock sector:
// crypto data comes from Coinbase, stock data from the owner's free Twelve Data key
// (refreshed in the background within its limits), and all sectors go through the
// same Briefing → Scout → Analyst pipeline against one paper account.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DESK_SYMBOLS } from '../constants';
import { loadDaily, loadPrices, load4h, loadChartCandles, TF } from './data/market';
import { explainMarketError, marketHealth, onMarketHealth } from '../lib/coinbaseMarket';
import { fetchHeadlines, fetchMarketHeadlines, sectorHeadlines, fetchFearGreed } from './data/news';
import { fetchCoinbaseBalance } from './data/balance';
import { getStockDaily, refreshStockDaily, getStockQuotes, loadStockChart, stockDataStatus, onStockDataStatus } from './data/stocks';
import { usMarketStatus } from './data/usMarket';
import { loadTdKey, saveTdKey, clearTdKey, tdCheckKey, explainTdError } from '../lib/twelveData';
import { notify } from '../lib/notify';
import { pageLink } from '../lib/platform';
import { runLiveCycle } from './live/liveTrader';
import { loadLive } from './live/liveStore';
import { closedOnly, readChart } from './chart/read';
import { atrSeries, last } from './chart/ta';
import { rsScore } from './agents/stocks';
import { runDesk, DESK_CONFIG } from './pipeline';
import { SECTORS, STOCK_SECTORS, MARKET_BENCHMARK, EXTRA_GAUGES, stockSymbols } from './universe';
import { newAccount, stepPosition, closePosition, summarize, STOCK_FEES } from './engine/account';

const STORAGE_KEY = 'pp_desk_v1';
const TICK_MS = 5 * 60_000;       // re-check prices, stops and signals
const BRIEFING_MS = 60 * 60_000;  // re-read news, Fear & Greed and the balance
const LOG_MAX = 150;
const STOCK_MIN_BARS = 200;       // the stock rules need a 200-day average
const MAX_STOCK_QUOTES = 6;       // live stock prices per run (Twelve Data free plan budget)
const STOCK_SET = new Set(stockSymbols());
const signalled = new Set(); // signal alerts already sent this session (one per symbol per day)

const DeskContext = createContext(null);

function freshState(now) {
  return {
    version: 2,
    account: newAccount(5000, now),
    watch: {},
    settings: { auto: true, shorts: false, sectors: {} },
    external: { headlines: [], sources: [], marketHeadlines: [], marketSources: [], fearGreed: null, coinbase: null, fetchedAt: 0 },
    last: null,
    log: [],
  };
}

// v1 was crypto-only: its saved-for-later list and last run belong to the crypto sector.
function migrate(s) {
  if (s?.version === 2 && s.account) return s;
  if (s?.version === 1 && s.account) {
    return { ...s, version: 2, watch: { crypto: s.watch ?? {} }, settings: { ...s.settings, sectors: {} }, last: null,
      external: { marketHeadlines: [], marketSources: [], ...s.external } };
  }
  return null;
}

function loadState() {
  try {
    const s = migrate(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    if (s) return s;
  } catch { /* corrupted — start fresh */ }
  return freshState(Date.now());
}

function persist(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* quota / private mode */ }
}

const money = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
// Link for notifications: the page on this site, or an app link in the iPhone app.
const siteUrl = (hash) => pageLink(hash);

// Percentile rank (0–100) of each value within the set.
function percentiles(values) {
  const entries = Object.entries(values).filter(([, v]) => v != null);
  const sorted = entries.map(([, v]) => v).sort((a, b) => a - b);
  const out = {};
  for (const [k, v] of entries) {
    let below = 0;
    for (const x of sorted) if (x < v) below++;
    out[k] = sorted.length > 1 ? (below / (sorted.length - 1)) * 100 : 50;
  }
  return out;
}

export function DeskProvider({ children }) {
  const [state, setState] = useState(loadState);
  const [status, setStatus] = useState({ running: false, phase: 'idle', detail: '', progress: null, error: null, notice: null, lastRun: null, nextRun: null, leader: true, stocks: stockDataStatus() });
  const [health, setHealth] = useState(marketHealth);
  const [prices, setPrices] = useState({});
  const stateRef = useRef(state);
  const busy = useRef(false);
  const accountEpoch = useRef(0);   // bumped when the user changes the account mid-run
  const rerun = useRef(false);

  const commit = useCallback((next) => {
    stateRef.current = next;
    setState(next);
    persist(next);
  }, []);

  const tick = useCallback(async ({ forceBriefing = false } = {}) => {
    if (busy.current) return;
    busy.current = true;
    const epoch = accountEpoch.current;
    const now = Date.now();
    const st = structuredClone(stateRef.current);
    const settings = stateRef.current.settings ?? {};
    const sectorsOn = settings.sectors ?? {};
    const step = (phase, detail, progress = null) => setStatus((s) => ({ ...s, running: true, phase, detail, progress, error: null }));
    try {
      // ── Agent 1 inputs: news, sentiment, balance (hourly) ──────────────────
      if (forceBriefing || now - (st.external.fetchedAt ?? 0) >= BRIEFING_MS) {
        step('briefing', 'Reading headlines, sentiment and balance');
        const [news, market, fearGreed, coinbase] = await Promise.all([
          fetchHeadlines().catch(() => ({ headlines: [], sources: [] })),
          fetchMarketHeadlines().catch(() => ({ headlines: [], sources: [] })),
          fetchFearGreed(),
          fetchCoinbaseBalance(),
        ]);
        st.external = {
          headlines: news.headlines, sources: news.sources,
          marketHeadlines: market.headlines, marketSources: market.sources,
          fearGreed, coinbase, fetchedAt: now,
        };
      }

      const groups = [], placeholders = [], notices = [];
      const holds = { all: null, groups: {}, syms: {} };
      const live = {};
      const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

      // ── Crypto (Coinbase) ──────────────────────────────────────────────────
      const cryptoMarket = {};
      if (sectorsOn.crypto !== false) {
        step('scout', 'Checking crypto charts', { done: 0, total: DESK_SYMBOLS.length });
        const day = await loadDaily(DESK_SYMBOLS, now, (done, total) => {
          if (total) step('scout', `Downloading crypto charts (${total} out of date)`, { done, total });
        });
        const quotes = await loadPrices(DESK_SYMBOLS);
        for (const sym of DESK_SYMBOLS) {
          const closed = day.daily[sym];
          if (!closed || closed.length < 60) continue;
          cryptoMarket[sym] = { d1: closed };
          const fresh = quotes[sym] ?? day.forming[sym];   // only fresh prices — never yesterday's close
          if (fresh != null) live[sym] = fresh;
        }
        if (!cryptoMarket.BTC) {
          const why = day.errors.BTC ? explainMarketError(day.errors.BTC) : 'Coinbase returned too little Bitcoin history.';
          placeholders.push({ id: 'crypto', status: 'error', statusText: `Could not load Bitcoin's daily chart from Coinbase. ${why}` });
        } else {
          const lastErr = Object.values(day.errors).find((e) => e?.kind !== 'not-listed');
          if (day.stale.BTC) {
            holds.groups.crypto = `crypto charts are out of date (latest ${dayOf(day.stale.BTC)})`;
            notices.push(`Coinbase has not provided the latest daily candles, so crypto is shown from saved charts up to ${dayOf(day.stale.BTC)} with no new crypto trades until they refresh.${lastErr ? ` ${explainMarketError(lastErr)}` : ''}`);
          } else {
            const staleSyms = Object.keys(day.stale).filter((s) => cryptoMarket[s]);
            for (const s of staleSyms) holds.syms[s] = `${s}'s daily chart is out of date (latest ${dayOf(day.stale[s])})`;
            const missing = Object.keys(day.errors).filter((s) => day.errors[s]?.kind !== 'not-listed' && !cryptoMarket[s]);
            const affected = [...new Set([...staleSyms, ...missing])];
            if (affected.length) notices.push(`${affected.length} coin${affected.length === 1 ? '' : 's'} could not be refreshed (${affected.slice(0, 6).join(', ')}${affected.length > 6 ? '…' : ''}) — no new trades on ${affected.length === 1 ? 'it' : 'them'}.`);
          }
          // 4-hour charts for open crypto positions and anything through its line.
          const need = new Set(Object.values(st.account.positions).filter((p) => (p.asset ?? 'crypto') === 'crypto').map((p) => p.sym));
          for (const [sym, m] of Object.entries(cryptoMarket)) {
            const r = readChart(m.d1);
            if (r && (r.d1.bar.close > r.d1.rangeHigh || r.d1.bar.close < r.d1.rangeLow)) need.add(sym);
          }
          const list = [...need].filter((s) => cryptoMarket[s]);
          step('analyst', `Loading 4-hour crypto charts for ${list.length} candidate${list.length === 1 ? '' : 's'}`);
          const h4 = await Promise.all(list.map((sym) => load4h(sym)));
          list.forEach((sym, i) => {
            if (!h4[i]) return;
            cryptoMarket[sym].h4 = closedOnly(h4[i], TF['4H'].ms, Math.min(now, h4[i].fetchedAt ?? now));
            if (live[sym] == null) live[sym] = h4[i][h4[i].length - 1].close;
          });
          if (!Object.keys(quotes).length) notices.push('Live crypto prices were unavailable this run. The desk will not open or close a trade without a fresh price.');
          groups.push({
            id: 'crypto', label: 'Crypto', kind: 'crypto', benchmark: 'BTC', market: cryptoMarket,
            headlines: st.external.headlines, fees: DESK_CONFIG.fees,
          });
        }
      }

      // ── Stocks (Twelve Data) ───────────────────────────────────────────────
      const enabledStock = STOCK_SECTORS.filter((s) => sectorsOn[s.id] !== false);
      const mkt = usMarketStatus(now);
      const stockDaily = {};
      const stockQuotes = {};
      if (enabledStock.length) {
        if (!loadTdKey()) {
          for (const s of enabledStock) placeholders.push({ id: s.id, status: 'no-key', statusText: 'Add your free Twelve Data key on the Portfolio page so the desk can read stock charts.' });
        } else {
          step('scout', 'Checking stock charts');
          const list = stockSymbols(sectorsOn);
          const heldStock = Object.values(st.account.positions).filter((p) => p.asset === 'stock').map((p) => p.sym);
          let liveStock = [];
          try { liveStock = Object.values(loadLive()?.positions ?? {}).filter((p) => p.asset === 'stock').map((p) => p.sym); } catch { /* no live store yet */ }
          const priority = [MARKET_BENCHMARK, ...EXTRA_GAUGES, ...enabledStock.map((s) => s.benchmark), ...heldStock, ...liveStock];
          refreshStockDaily(list, { priority }).catch(() => {}); // background; this run uses what is already stored
          const { daily, stale } = await getStockDaily(list);
          Object.assign(stockDaily, daily);

          // Relative strength across every stock the desk follows, and across sector ETFs.
          const rsRaw = {}, etfRaw = {};
          for (const s of enabledStock) {
            for (const sym of s.symbols) if (daily[sym]?.length >= 70) rsRaw[sym] = rsScore(daily[sym]);
            if (daily[s.benchmark]?.length >= 70) etfRaw[s.id] = rsScore(daily[s.benchmark]);
          }
          const rsRank = percentiles(rsRaw);
          const sectorRank = percentiles(etfRaw);

          // Live quotes (market hours only): held positions first, then fresh breakouts.
          const candidates = [];
          for (const s of enabledStock) for (const sym of s.symbols) {
            const c = daily[sym];
            if (!c || c.length < 60) continue;
            const prevHigh = Math.max(...c.slice(-51, -1).map((b) => b.high));
            if (c[c.length - 1].close > prevHigh) candidates.push(sym);
          }
          const quoteSyms = [...new Set([...heldStock, ...liveStock, ...candidates])].slice(0, MAX_STOCK_QUOTES);
          if (mkt.open && quoteSyms.length) {
            step('analyst', `Getting live prices for ${quoteSyms.length} stock${quoteSyms.length === 1 ? '' : 's'}`);
            const q = await getStockQuotes(quoteSyms).catch(() => ({ quotes: {} }));
            for (const [sym, quote] of Object.entries(q.quotes ?? {})) {
              if (quote?.price > 0) { live[sym] = quote.price; stockQuotes[sym] = quote; }
            }
          }

          const staleStocks = Object.entries(stale).filter(([, d]) => d != null).map(([s]) => s);
          for (const s of staleStocks) holds.syms[s] = `${s}'s daily chart is not up to date yet`;
          for (const s of enabledStock) {
            const market = {};
            for (const sym of s.symbols) if (daily[sym]?.length >= STOCK_MIN_BARS) market[sym] = { d1: daily[sym] };
            const spy = daily[MARKET_BENCHMARK];
            if (!spy || spy.length < STOCK_MIN_BARS || !Object.keys(market).length) {
              const st2 = stockDataStatus();
              placeholders.push({ id: s.id, status: 'loading', statusText: st2.error ?? `Loading stock history from Twelve Data (${st2.loaded}/${st2.total} ready). The free plan allows 8 symbols a minute, so the first load takes about 12 minutes.` });
              continue;
            }
            if (!mkt.open) holds.groups[s.id] = `the US stock market is closed (${mkt.label})`;
            groups.push({
              id: s.id, label: s.label, kind: 'stock', benchmark: s.benchmark, gauge: s.gauge ?? null, market,
              regimeD1: spy, sectorD1: daily[s.benchmark] ?? null, gaugeD1: s.gauge ? daily[s.gauge] ?? null : null,
              headlines: sectorHeadlines(st.external.marketHeadlines ?? [], s),
              fees: STOCK_FEES, rsRank, sectorRank: sectorRank[s.id] ?? 50, marketOpen: mkt.open,
              riskMult: s.riskMult ?? 1, maxPositionPct: 20,
            });
          }
        }
      }

      // ── Stops: replay bars since each position was last checked, so a stop hit
      //    while the site was closed is still honoured, then test the live price.
      const stopped = [];
      for (const pos of Object.values(st.account.positions)) {
        let trade = null;
        if ((pos.asset ?? 'crypto') === 'crypto') {
          const bars = cryptoMarket[pos.sym]?.h4 ?? [];
          const from = pos.steppedTo ?? pos.entryTime;
          for (const bar of bars) {
            if (bar.time < from) continue;
            trade = stepPosition(st.account, pos.sym, bar, null);
            if (trade) break;
            pos.steppedTo = bar.time + TF['4H'].ms;
          }
          const px = live[pos.sym];
          if (!trade && px != null) trade = stepPosition(st.account, pos.sym, { time: now, open: px, high: px, low: px, close: px }, null);
        } else {
          const bars = stockDaily[pos.sym] ?? [];
          const atr = bars.length > 20 ? last(atrSeries(bars, 14)) : null;
          const entryDay = new Date(pos.entryTime).toISOString().slice(0, 10);
          for (const bar of bars) {
            if (bar.date <= (pos.steppedDate ?? entryDay)) continue; // only whole sessions after entry
            trade = stepPosition(st.account, pos.sym, bar, atr);
            if (trade) break;
            pos.steppedDate = bar.date;
          }
          const q = stockQuotes[pos.sym];
          if (!trade && q && mkt.open) {
            const today = mkt.todayET;
            const bar = entryDay < today
              ? { time: now, open: q.open ?? q.price, high: Math.max(q.high ?? q.price, q.price), low: Math.min(q.low ?? q.price, q.price), close: q.price }
              : { time: now, open: q.price, high: q.price, low: q.price, close: q.price };
            trade = stepPosition(st.account, pos.sym, bar, atr);
          }
        }
        if (trade) stopped.push(trade);
      }

      if (!groups.length && placeholders.some((p) => p.status === 'error')) {
        throw new Error(placeholders.find((p) => p.status === 'error').statusText);
      }

      // ── Briefing → Scout → Analyst → paper execution, all sectors at once ──
      step('analyst', 'Agents are reviewing every sector');
      const res = runDesk({
        now, account: st.account, groups, watch: st.watch, livePrices: live, holds,
        external: { fearGreed: st.external.fearGreed, coinbase: st.external.coinbase },
        config: { ...DESK_CONFIG, allowShorts: !!settings.shorts, execute: !!settings.auto, requireLivePrice: true },
      });

      const labelOf = (id) => SECTORS.find((s) => s.id === id)?.label ?? id;
      const entries = [];
      const add = (kind, text) => entries.push({ time: now, kind, text });
      const closedAll = [...stopped, ...res.closed];
      for (const t of closedAll) add(t.net > 0 ? 'win' : 'loss', `Closed ${t.dir > 0 ? 'long' : 'short'} ${t.sym} (${labelOf(t.sector ?? 'crypto')}) — ${t.reason} — ${money(t.net)}${t.asset === 'stock' ? '' : ' after fees'}`);
      for (const p of res.opened) add('open', `Opened ${p.dir > 0 ? 'long' : 'short'} ${p.sym} (${labelOf(p.sector)}) with ${money(p.notional)} — stop ${p.stop.toPrecision(5)}`);
      for (const g of res.groups) {
        for (const [sym, w] of Object.entries(g.watch)) if (!st.watch?.[g.id]?.[sym]) add('watch', `Saved ${sym} (${g.label}) for later — waiting for ${w.trigger}`);
        const prev = st.last?.groups?.find((x) => x.id === g.id)?.brief;
        if (prev && g.brief && prev.allowLong !== g.brief.allowLong) add('brief', `${g.label}: buying ${g.brief.allowLong ? 'now allowed' : 'now blocked'}`);
      }

      if (accountEpoch.current !== epoch) { // the user reset or traded mid-run — discard this pass and go again
        rerun.current = true;
        setStatus((s) => ({ ...s, running: false, phase: 'idle', detail: '', progress: null }));
        return;
      }
      st.watch = Object.fromEntries(res.groups.map((g) => [g.id, g.watch]));
      const byId = new Map(res.groups.map((g) => [g.id, g]));
      const phById = new Map(placeholders.map((p) => [p.id, p]));
      st.last = {
        time: now,
        notices,
        groups: SECTORS.map((s) => {
          const base = { id: s.id, label: s.label, kind: s.kind, benchmark: s.benchmark };
          if (sectorsOn[s.id] === false) return { ...base, status: 'disabled', statusText: 'Switched off in Portfolio settings.', brief: null, scouts: [], analyses: [] };
          const g = byId.get(s.id);
          if (g) return { ...base, status: 'ok', statusText: '', brief: g.brief, scouts: g.scouts, analyses: g.analyses };
          const p = phById.get(s.id);
          return { ...base, status: p?.status ?? 'loading', statusText: p?.statusText ?? 'Waiting for data.', brief: null, scouts: [], analyses: [] };
        }),
      };
      st.log = [...entries, ...st.log].slice(0, LOG_MAX);
      st.settings = stateRef.current.settings;
      commit(st);
      setPrices((p) => ({ ...p, ...live }));
      setStatus((s) => ({ ...s, running: false, phase: 'idle', detail: '', progress: null, error: null, notice: notices.join(' ') || null, lastRun: now, nextRun: now + TICK_MS }));

      // ── Alerts and live trading (after the paper account is saved) ─────────
      for (const p of res.opened) {
        notify({ title: `Paper trade: BUY ${p.sym}`, message: `${labelOf(p.sector)} · ${money(p.notional)} at ${p.entry.toPrecision(6)} · stop ${p.stop.toPrecision(6)}`, event: 'paperTrades', priority: 3, url: siteUrl('#/paper'), sequenceId: `paper_${p.id}` });
      }
      for (const t of closedAll) {
        notify({ title: `Paper trade closed: ${t.sym} ${t.net >= 0 ? '+' : '-'}$${Math.abs(t.net).toFixed(2)}`, message: `${labelOf(t.sector ?? 'crypto')} · ${t.reason}`, event: 'paperTrades', priority: 3, url: siteUrl('#/paper') });
      }
      for (const g of res.groups) for (const a of g.analyses) {
        const key = `${a.sym}|${dayOf(now)}`;
        if (a.decision === 'REJECT' || signalled.has(key)) continue;
        signalled.add(key);
        notify({ title: `Signal: ${a.decision} ${a.sym} (${g.label})`, message: a.note ? `${a.summary} ${a.note}` : a.summary, event: 'signals', priority: 3, url: siteUrl('#/desk') });
      }
      runLiveCycle({
        now, opened: res.opened, closed: closedAll, paperPositions: st.account.positions,
        prices: live, stockMarketOpen: mkt.open,
      }).catch(() => {});
    } catch (e) {
      setStatus((s) => ({ ...s, running: false, phase: 'idle', detail: '', progress: null, error: String(e?.message ?? e), notice: null, nextRun: Date.now() + TICK_MS }));
    } finally {
      busy.current = false;
      if (rerun.current) { rerun.current = false; setTimeout(() => tickRef.current?.(), 50); }
    }
  }, [commit]);
  const tickRef = useRef(tick);
  useEffect(() => { tickRef.current = tick; }, [tick]);

  useEffect(() => onMarketHealth(setHealth), []);
  useEffect(() => onStockDataStatus((stocks) => setStatus((s) => ({ ...s, stocks }))), []);

  // Run on load, every few minutes, and when the tab wakes up after a long sleep.
  // Only one tab runs the desk at a time (the others just show its results),
  // so opening several tabs does not multiply the requests sent out.
  useEffect(() => {
    let stopped = false, timer = null, release = null, leading = false;
    const lead = () => {
      leading = true;
      setStatus((s) => ({ ...s, leader: true }));
      tick();
      timer = setInterval(tick, TICK_MS);
    };
    if (navigator.locks?.request) {
      setStatus((s) => ({ ...s, leader: false }));
      navigator.locks.request('pp-desk-runner', () => {
        if (stopped) return undefined;
        lead();
        return new Promise((resolve) => { release = resolve; });
      }).catch(() => { if (!stopped && !leading) lead(); });
    } else {
      lead();
    }
    const onVisible = () => {
      if (leading && document.visibilityState === 'visible' && Date.now() - (stateRef.current.last?.time ?? 0) > TICK_MS) tick();
    };
    // Another tab of this site saved newer state — adopt it rather than fight over it.
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const s = migrate(JSON.parse(e.newValue));
        if (!s) return;
        if (JSON.stringify(s.account) !== JSON.stringify(stateRef.current.account)) accountEpoch.current++;
        stateRef.current = s;
        setState(s);
      } catch { /* ignore */ }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('storage', onStorage);
    return () => {
      stopped = true;
      clearInterval(timer);
      release?.();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
    };
  }, [tick]);

  const setSetting = useCallback((key, value) => {
    commit({ ...stateRef.current, settings: { ...stateRef.current.settings, [key]: value } });
  }, [commit]);

  const actions = useMemo(() => ({
    runNow: () => tick({ forceBriefing: true }),
    setAuto: (v) => setSetting('auto', !!v),
    setShorts: (v) => setSetting('shorts', !!v),
    setSector: (id, enabled) => setSetting('sectors', { ...(stateRef.current.settings.sectors ?? {}), [id]: !!enabled }),
    setTwelveDataKey: async (key) => {
      const k = String(key ?? '').trim();
      if (!k) return { ok: false, error: 'Paste your Twelve Data API key first.' };
      const check = await tdCheckKey(k);
      if (!check.ok) return { ok: false, error: explainTdError(check.error) };
      saveTdKey(k);
      setStatus((s) => ({ ...s, stocks: stockDataStatus() }));
      tick();
      return { ok: true };
    },
    clearTwelveDataKey: () => { clearTdKey(); setStatus((s) => ({ ...s, stocks: stockDataStatus() })); },
    reset: () => { accountEpoch.current++; commit(freshState(Date.now())); tick({ forceBriefing: true }); },
    closePosition: (sym) => {
      const st = structuredClone(stateRef.current);
      const pos = st.account.positions[sym];
      if (!pos) return;
      const now = Date.now();
      const t = closePosition(st.account, sym, prices[sym] ?? pos.lastPrice, 'Closed by hand', now);
      st.log = [{ time: now, kind: t.net > 0 ? 'win' : 'loss', text: `Closed ${t.dir > 0 ? 'long' : 'short'} ${sym} by hand — ${money(t.net)}` }, ...st.log].slice(0, LOG_MAX);
      accountEpoch.current++;
      commit(st);
    },
    // Candles for a chart: { d1, h4 } with the forming bar included.
    loadChart: (sym) => (STOCK_SET.has(sym) && !DESK_SYMBOLS.includes(sym) ? loadStockChart(sym) : loadChartCandles(sym)),
  }), [tick, setSetting, commit, prices]);

  const summary = useMemo(() => summarize(state.account, prices), [state.account, prices]);
  const value = useMemo(() => ({ state, status, health, prices, summary, actions, config: DESK_CONFIG }), [state, status, health, prices, summary, actions]);
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDesk() {
  const ctx = useContext(DeskContext);
  if (!ctx) throw new Error('useDesk must be used inside <DeskProvider>');
  return ctx;
}

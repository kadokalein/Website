// Runs the Trading Desk for as long as any page of the site is open, and shares
// its state with every page. All state lives in this browser (localStorage).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DESK_SYMBOLS } from '../constants';
import { loadDaily, loadPrices, load4h, loadChartCandles, TF } from './data/market';
import { explainMarketError, marketHealth, onMarketHealth } from '../lib/coinbaseMarket';
import { fetchHeadlines, fetchFearGreed } from './data/news';
import { fetchCoinbaseBalance } from './data/balance';
import { closedOnly, readChart } from './chart/read';
import { runCycle, DESK_CONFIG } from './pipeline';
import { newAccount, stepPosition, closePosition, summarize } from './engine/account';

const STORAGE_KEY = 'pp_desk_v1';
const TICK_MS = 5 * 60_000;       // re-check prices, stops and signals
const BRIEFING_MS = 60 * 60_000;  // re-read news, Fear & Greed and the balance
const LOG_MAX = 120;

const DeskContext = createContext(null);

function freshState(now) {
  return {
    version: 1,
    account: newAccount(5000, now),
    watch: {},
    settings: { auto: true, shorts: false },
    external: { headlines: [], sources: [], fearGreed: null, coinbase: null, fetchedAt: 0 },
    last: null,
    log: [],
  };
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (s?.version === 1 && s.account) return s;
  } catch { /* corrupted — start fresh */ }
  return freshState(Date.now());
}

function persist(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* quota / private mode */ }
}

const money = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;

export function DeskProvider({ children }) {
  const [state, setState] = useState(loadState);
  const [status, setStatus] = useState({ running: false, phase: 'idle', detail: '', progress: null, error: null, notice: null, lastRun: null, nextRun: null, leader: true });
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
    const step = (phase, detail, progress = null) => setStatus((s) => ({ ...s, running: true, phase, detail, progress, error: null }));
    try {
      // ── Agent 1 inputs: news, sentiment, balance (hourly) ──────────────────
      if (forceBriefing || now - (st.external.fetchedAt ?? 0) >= BRIEFING_MS) {
        step('briefing', 'Reading headlines, sentiment and balance');
        const [news, fearGreed, coinbase] = await Promise.all([
          fetchHeadlines().catch(() => ({ headlines: [], sources: [] })),
          fetchFearGreed(),
          fetchCoinbaseBalance(),
        ]);
        st.external = { headlines: news.headlines, sources: news.sources, fearGreed, coinbase, fetchedAt: now };
      }

      // ── Daily charts: saved copy, refreshed only after a new day has closed ──
      step('scout', 'Checking daily charts', { done: 0, total: DESK_SYMBOLS.length });
      const day = await loadDaily(DESK_SYMBOLS, now, (done, total) => {
        if (total) step('scout', `Downloading daily charts (${total} out of date)`, { done, total });
      });
      const quotes = await loadPrices(DESK_SYMBOLS);
      const market = {}, live = {};
      for (const sym of DESK_SYMBOLS) {
        const closed = day.daily[sym];
        if (!closed || closed.length < 60) continue;
        market[sym] = { d1: closed };
        // Only fresh prices: never trade or test stops on yesterday's close.
        const fresh = quotes[sym] ?? day.forming[sym];
        if (fresh != null) live[sym] = fresh;
      }
      if (!market.BTC) {
        const why = day.errors.BTC ? explainMarketError(day.errors.BTC) : 'Coinbase returned too little Bitcoin history.';
        throw new Error(`Could not load Bitcoin's daily chart from Coinbase. ${why}`);
      }
      // Out-of-date daily charts can still be shown, but no new trade is opened on them.
      const notices = [];
      const holds = { all: null, syms: {} };
      const lastErr = Object.values(day.errors).find((e) => e?.kind !== 'not-listed');
      const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
      if (day.stale.BTC) {
        holds.all = `daily charts are out of date (latest ${dayOf(day.stale.BTC)})`;
        notices.push(`Coinbase has not provided the latest daily candles, so the desk is showing saved charts up to ${dayOf(day.stale.BTC)} and will not open new trades until they refresh.${lastErr ? ` ${explainMarketError(lastErr)}` : ''}`);
      } else {
        const staleSyms = Object.keys(day.stale).filter((s) => market[s]);
        for (const s of staleSyms) holds.syms[s] = `${s}'s daily chart is out of date (latest ${dayOf(day.stale[s])})`;
        const missing = Object.keys(day.errors).filter((s) => day.errors[s]?.kind !== 'not-listed' && !market[s]);
        const affected = [...new Set([...staleSyms, ...missing])];
        if (affected.length) notices.push(`${affected.length} coin${affected.length === 1 ? '' : 's'} could not be refreshed (${affected.slice(0, 6).join(', ')}${affected.length > 6 ? '…' : ''}) — skipped or shown from saved charts, with no new trades on ${affected.length === 1 ? 'it' : 'them'}.`);
      }

      // ── 4-hour charts for open positions and anything through its line ─────
      const need = new Set(Object.keys(st.account.positions));
      for (const [sym, m] of Object.entries(market)) {
        const r = readChart(m.d1);
        if (r && (r.d1.bar.close > r.d1.rangeHigh || r.d1.bar.close < r.d1.rangeLow)) need.add(sym);
      }
      const list = [...need].filter((s) => market[s]);
      step('analyst', `Loading 4-hour charts for ${list.length} candidate${list.length === 1 ? '' : 's'}`);
      const h4 = await Promise.all(list.map((sym) => load4h(sym)));
      list.forEach((sym, i) => {
        if (!h4[i]) return;
        market[sym].h4 = closedOnly(h4[i], TF['4H'].ms, Math.min(now, h4[i].fetchedAt ?? now));
        if (live[sym] == null) live[sym] = h4[i][h4[i].length - 1].close;
      });
      const noPrice = Object.keys(st.account.positions).filter((s) => live[s] == null);
      if (!Object.keys(quotes).length) notices.push(`Live prices were unavailable this run${noPrice.length ? ` (no fresh price for ${noPrice.join(', ')})` : ''}. The desk will not open or close a trade without a fresh price.`);

      // ── Stops: replay every closed 4H bar since each position was last checked,
      //    so a stop hit while the site was closed is still honoured, then test the live price.
      const stopped = [];
      const fees = DESK_CONFIG.fees;
      for (const pos of Object.values(st.account.positions)) {
        const bars = market[pos.sym]?.h4 ?? [];
        const from = pos.steppedTo ?? pos.entryTime;
        let trade = null;
        for (const bar of bars) {
          if (bar.time < from) continue; // bars that began before entry / already replayed
          trade = stepPosition(st.account, pos.sym, bar, null, fees);
          if (trade) break;
          pos.steppedTo = bar.time + TF['4H'].ms;
        }
        const px = live[pos.sym];
        if (!trade && px != null) trade = stepPosition(st.account, pos.sym, { time: now, open: px, high: px, low: px, close: px }, null, fees);
        if (trade) stopped.push(trade);
      }

      // ── Briefing → Scout → Analyst → paper execution ──────────────────────
      const res = runCycle({
        now, market, account: st.account, watch: st.watch, livePrices: live, holds,
        external: { fearGreed: st.external.fearGreed, headlines: st.external.headlines, coinbase: st.external.coinbase },
        config: { ...DESK_CONFIG, allowShorts: !!stateRef.current.settings.shorts, execute: !!stateRef.current.settings.auto, requireLivePrice: true },
      });

      const entries = [];
      const add = (kind, text) => entries.push({ time: now, kind, text });
      for (const t of [...stopped, ...res.closed]) {
        add(t.net > 0 ? 'win' : 'loss', `Closed ${t.dir > 0 ? 'long' : 'short'} ${t.sym} — ${t.reason} — ${money(t.net)} after fees`);
      }
      for (const p of res.opened) add('open', `Opened ${p.dir > 0 ? 'long' : 'short'} ${p.sym} with ${money(p.notional)} — stop ${p.stop.toPrecision(5)}`);
      for (const [sym, w] of Object.entries(res.watch)) {
        if (!st.watch[sym]) add('watch', `Saved ${sym} for later — waiting for ${w.trigger}`);
      }
      const prevPhase = st.last?.brief?.regime?.phase;
      if (prevPhase && prevPhase !== res.brief.regime.phase) add('brief', `Market regime changed: ${prevPhase} → ${res.brief.regime.phase}`);

      if (accountEpoch.current !== epoch) { // the user reset or traded mid-run — discard this pass and go again
        rerun.current = true;
        setStatus((s) => ({ ...s, running: false, phase: 'idle', detail: '', progress: null }));
        return;
      }
      st.watch = res.watch;
      st.last = { time: now, brief: res.brief, scouts: res.scouts, analyses: res.analyses };
      st.log = [...entries, ...st.log].slice(0, LOG_MAX);
      st.settings = stateRef.current.settings;
      commit(st);
      setPrices(live);
      setStatus((s) => ({ ...s, running: false, phase: 'idle', detail: '', progress: null, error: null, notice: notices.join(' ') || null, lastRun: now, nextRun: now + TICK_MS }));
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

  // Run on load, every few minutes, and when the tab wakes up after a long sleep.
  // Only one tab runs the desk at a time (the others just show its results),
  // so opening several tabs does not multiply the requests sent to Coinbase.
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
        const s = JSON.parse(e.newValue);
        if (s?.version !== 1) return;
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
    reset: () => { accountEpoch.current++; commit(freshState(Date.now())); tick({ forceBriefing: true }); },
    closePosition: (sym) => {
      const st = structuredClone(stateRef.current);
      const pos = st.account.positions[sym];
      if (!pos) return;
      const now = Date.now();
      const t = closePosition(st.account, sym, prices[sym] ?? pos.lastPrice, 'Closed by hand', now, DESK_CONFIG.fees.taker);
      st.log = [{ time: now, kind: t.net > 0 ? 'win' : 'loss', text: `Closed ${t.dir > 0 ? 'long' : 'short'} ${sym} by hand — ${money(t.net)} after fees` }, ...st.log].slice(0, LOG_MAX);
      accountEpoch.current++;
      commit(st);
    },
    // Candles for a chart: { d1, h4 } with the forming bar included (shared, cached client).
    loadChart: (sym) => loadChartCandles(sym),
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

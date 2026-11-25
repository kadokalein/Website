// Saved state of automatic live trading on Coinbase (real money). Lives in this
// browser's localStorage, so every tab of the site sees the same positions and log.
//
// Shape (key 'pp_live_auto_v1'):
//   mode:         'off' | 'auto' | 'confirm'   ('confirm' = every trade needs a Confirm)
//   enabledAt, enabledBy
//   positions:    { SYM: { sym, asset: 'crypto'|'stock', sector, productId, qty, entryPrice, entryTime,
//                          stop, initialStop, exitLevel, stopOrderId|null, clientOrderId,
//                          status: 'open'|'closing'|'pending', cost, ... } }
//                 'pending' = a buy was sent but Coinbase had not reported the fill yet.
//   days:         { 'YYYY-MM-DD' (UTC): { startEquity, realized, marks?, halted? } }
//   consecutiveFailures
//   log:          [{ time, kind: 'info'|'buy'|'sell'|'error'|'confirm', text }]  newest first, max 200
//   lastCycle:    { time, ok, text }
//   account:      { equity, cash, time } — last balance read from Coinbase (for display)
//   handled:      { clientOrderId: time } — desk trades already acted on (never acted on twice)

export const LIVE_STORAGE_KEY = 'pp_live_auto_v1';
export const LIVE_MODES = ['off', 'auto', 'confirm'];
const LOG_MAX = 200;
const HANDLED_MAX = 200;
const DAYS_MAX = 40;

const defaults = () => ({
  version: 1,
  mode: 'off',
  enabledAt: null,
  enabledBy: null,
  positions: {},
  days: {},
  consecutiveFailures: 0,
  log: [],
  lastCycle: null,
  account: null,
  handled: {},
});

let memory = null; // used when localStorage is unavailable (private mode, tests)
const listeners = new Set();

function normalize(raw) {
  const base = defaults();
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base, ...raw };
  if (!LIVE_MODES.includes(s.mode)) s.mode = 'off';
  for (const k of ['positions', 'days', 'handled']) if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = {};
  if (!Array.isArray(s.log)) s.log = [];
  s.consecutiveFailures = Number(s.consecutiveFailures) || 0;
  return s;
}

function readRaw() {
  try {
    if (typeof localStorage !== 'undefined') {
      const text = localStorage.getItem(LIVE_STORAGE_KEY);
      if (text != null) return JSON.parse(text);
      return memory;
    }
  } catch { /* corrupted or blocked — fall back to memory */ }
  return memory;
}

function writeRaw(s) {
  memory = s;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify(s));
  } catch { /* quota / private mode: memory copy still works for this tab */ }
}

function emit(s) {
  for (const fn of [...listeners]) {
    try { fn(s); } catch { /* a broken listener must not stop trading */ }
  }
}

function trim(s) {
  if (s.log.length > LOG_MAX) s.log = s.log.slice(0, LOG_MAX);
  const handled = Object.entries(s.handled);
  if (handled.length > HANDLED_MAX) s.handled = Object.fromEntries(handled.sort((a, b) => b[1] - a[1]).slice(0, HANDLED_MAX));
  const days = Object.keys(s.days).sort();
  if (days.length > DAYS_MAX) for (const k of days.slice(0, days.length - DAYS_MAX)) delete s.days[k];
  return s;
}

// Fresh copy of the saved state (always re-read, so other tabs' changes are seen).
export function loadLive() {
  return normalize(structuredClone(readRaw()));
}

// saveLive({ mode: 'auto' }) merges a patch; saveLive((s) => { s.positions.SOL = … }) edits a copy
// (return a new object or mutate and return nothing). Returns the saved state.
export function saveLive(patchOrUpdater) {
  const cur = loadLive();
  let next;
  if (typeof patchOrUpdater === 'function') {
    const out = patchOrUpdater(cur);
    next = out && typeof out === 'object' ? out : cur;
  } else {
    next = { ...cur, ...(patchOrUpdater ?? {}) };
  }
  next = trim(normalize(next));
  writeRaw(next);
  emit(next);
  return next;
}

// Calls fn(state) whenever the state changes in this tab or another tab. → unsubscribe
export function onLive(fn) {
  listeners.add(fn);
  const onStorage = (e) => { if (e.key === LIVE_STORAGE_KEY) fn(loadLive()); };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

// Tell listeners to re-read (e.g. the trader started or finished a cycle) without changing anything.
export function pingLive() {
  emit(loadLive());
}

function logEntry(kind, text) {
  return { time: Date.now(), kind, text: String(text) };
}

export function addLiveLog(kind, text) {
  return saveLive((s) => { s.log = [logEntry(kind, text), ...s.log]; });
}

const MODE_TEXT = {
  off: 'Automatic trading switched off',
  auto: 'Auto Trade switched on — trades are placed without asking',
  confirm: 'Auto Trade W/Confirmations switched on — every trade waits for your Confirm',
};

export function setMode(mode, by = null) {
  if (!LIVE_MODES.includes(mode)) throw new Error(`Unknown live trading mode: ${mode}`);
  return saveLive((s) => {
    if (s.mode === mode) return;
    s.mode = mode;
    if (mode !== 'off') {
      s.enabledAt = Date.now();
      s.enabledBy = by ?? null;
      s.consecutiveFailures = 0;
    }
    s.log = [logEntry('info', `${MODE_TEXT[mode]}${by ? ` (by ${by})` : ''}.`), ...s.log];
  });
}

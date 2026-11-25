// Alerts for the Trading Desk: browser notifications on this computer, and phone
// alerts through the free ntfy app (https://ntfy.sh).
//
// Phone alerts are published straight from the browser to ntfy.sh. Each browser makes
// two random private "topics" (channel names) and keeps them in localStorage only:
//   alert topic  the phone subscribes to it and receives the alerts
//   reply topic  the phone's Confirm / Reject buttons post their answer here; only this
//                page listens to it (with an EventSource)
// Anyone who knows a topic name can read and post to it, so the names are treated as
// passwords and messages never carry keys, balances or the localhost proxy address.
//
// Trade confirmations FAIL CLOSED: the only answers that count are a valid, single-use,
// in-time reply from the phone or a click on the site itself. Anything else, including
// silence until the time limit, is 'timeout', which callers must treat as "no trade".

const STORAGE = 'pp_notify_v1';
const NTFY = 'https://ntfy.sh';
const TOPIC_RE = { alert: /^pp-a-[A-Za-z0-9]{22}$/, reply: /^pp-r-[A-Za-z0-9]{22}$/ };
const TITLE_MAX = 120;
const MESSAGE_MAX = 600;
const DEFAULT_TTL = 120_000;
const OPEN_WAIT_MS = 8_000;     // how long askConfirm waits for the reply stream before publishing anyway
const STALE_MS = 100_000;       // ntfy sends a keepalive every ~45 s; this much silence = dead stream
const WATCHDOG_MS = 15_000;
const SEEN_MAX = 500;
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const DEFAULTS = Object.freeze({
  prompted: false,
  browser: false,
  ntfy: Object.freeze({ enabled: false, alertTopic: null, replyTopic: null }),
  events: Object.freeze({ paperTrades: true, liveTrades: true, signals: false }),
});

const hasWindow = typeof window !== 'undefined';
const nowSec = () => Math.floor(Date.now() / 1000);

// ─── Small helpers ──────────────────────────────────────────────────────────

function randomBase62(len) {
  let out = '';
  const buf = new Uint8Array(len * 2);
  while (out.length < len) {
    globalThis.crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < len; i++) {
      if (buf[i] < 248) out += BASE62[buf[i] % 62]; // 248 = 4 * 62, so no modulo bias
    }
  }
  return out;
}

// Compares in time that depends only on the expected value's length.
function safeEqual(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= (given.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  return diff === 0;
}

function clip(text, max) {
  const s = String(text ?? '').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

// Defence in depth: never let a key, a key name or a local address reach a notification.
function scrub(text) {
  return String(text ?? '')
    .replace(/-----BEGIN[\s\S]*?(-----END[^-]*-----|$)/g, '[hidden]')
    .replace(/organizations\/[^\s/]+\/apiKeys\/\S+/g, '[hidden]')
    .replace(/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?\S*/gi, '[local address]');
}

function baseUrl() {
  try { return import.meta.env.BASE_URL || '/'; } catch { return '/'; }
}
function siteOrigin() {
  return typeof location !== 'undefined' && location.origin && location.origin !== 'null'
    ? location.origin : 'https://kadokalein.github.io';
}
function deskUrl() {
  return `${siteOrigin()}${baseUrl()}#/desk`;
}

// http(s) only. '#/live' style links resolve against the site. Local addresses are dropped
// unless they are the page's own origin (local development).
function resolveUrl(url) {
  if (!url) return deskUrl();
  try {
    const s = String(url);
    const u = s.startsWith('#') ? new URL(`${siteOrigin()}${baseUrl()}${s}`) : new URL(s, `${siteOrigin()}${baseUrl()}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return deskUrl();
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(u.hostname) && u.origin !== siteOrigin()) return deskUrl();
    return u.href;
  } catch {
    return deskUrl();
  }
}

// ntfy only accepts [-_A-Za-z0-9]{1,64} as a sequence id.
function seqId(raw) {
  if (raw == null || raw === '') return null;
  return String(raw).replace(/[^-_A-Za-z0-9]/g, '_').slice(0, 64);
}

function clampPriority(p) {
  const n = Math.round(Number(p));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
}

// ─── Settings ───────────────────────────────────────────────────────────────

let cache = null;
const settingsListeners = new Set();

function isObj(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  if (!isObj(patch)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

function sanitize(raw) {
  const r = isObj(raw) ? raw : {};
  const n = isObj(r.ntfy) ? r.ntfy : {};
  const e = isObj(r.events) ? r.events : {};
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  return {
    prompted: bool(r.prompted, DEFAULTS.prompted),
    browser: bool(r.browser, DEFAULTS.browser),
    ntfy: {
      enabled: bool(n.enabled, DEFAULTS.ntfy.enabled),
      alertTopic: typeof n.alertTopic === 'string' && TOPIC_RE.alert.test(n.alertTopic) ? n.alertTopic : null,
      replyTopic: typeof n.replyTopic === 'string' && TOPIC_RE.reply.test(n.replyTopic) ? n.replyTopic : null,
    },
    events: {
      paperTrades: bool(e.paperTrades, DEFAULTS.events.paperTrades),
      liveTrades: bool(e.liveTrades, DEFAULTS.events.liveTrades),
      signals: bool(e.signals, DEFAULTS.events.signals),
    },
  };
}

function emitSettings() {
  const s = loadNotifySettings();
  for (const fn of [...settingsListeners]) { try { fn(s); } catch { /* a listener's problem */ } }
}

// The same object is returned until the settings change (safe for useSyncExternalStore).
export function loadNotifySettings() {
  if (cache) return cache;
  let raw;
  try { raw = JSON.parse(localStorage.getItem(STORAGE) ?? 'null'); } catch { raw = null; }
  cache = sanitize(deepMerge(DEFAULTS, raw));
  return cache;
}

export function saveNotifySettings(patch) {
  cache = sanitize(deepMerge(loadNotifySettings(), patch));
  try { localStorage.setItem(STORAGE, JSON.stringify(cache)); } catch { /* private mode: keep it in memory */ }
  emitSettings();
  syncStream();
  return cache;
}

export function onNotifySettings(fn) {
  settingsListeners.add(fn);
  return () => { settingsListeners.delete(fn); };
}

export function ensureTopics() {
  const { alertTopic, replyTopic } = loadNotifySettings().ntfy;
  if (alertTopic && replyTopic) return { alertTopic, replyTopic };
  const next = { alertTopic: alertTopic ?? `pp-a-${randomBase62(22)}`, replyTopic: replyTopic ?? `pp-r-${randomBase62(22)}` };
  saveNotifySettings({ ntfy: next });
  return next;
}

// New private channel names. The phone must subscribe to the new alert topic. Confirmations
// already waiting stop listening for phone answers (they can still be answered on the site).
export function rotateTopics() {
  const next = { alertTopic: `pp-a-${randomBase62(22)}`, replyTopic: `pp-r-${randomBase62(22)}` };
  saveNotifySettings({ ntfy: next });
  return next;
}

// ntfy app link that subscribes the Android app to a topic (also used for the QR code).
export function phoneSubscribeLink(topic) {
  return `ntfy://ntfy.sh/${topic}?display=Promethea%20Trades`;
}

if (hasWindow) {
  try {
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE) return;
      cache = null;
      emitSettings();
      syncStream();
    });
  } catch { /* */ }
}

// ─── Last problem (for the settings card) ───────────────────────────────────

let lastError = null;
const errorListeners = new Set();

function setLastError(message) {
  const next = message ? { message, at: Date.now() } : null;
  if (!next && !lastError) return;
  lastError = next;
  for (const fn of [...errorListeners]) { try { fn(lastError); } catch { /* */ } }
}

// → { message, at } | null. Cleared when a later phone alert goes through.
export function lastNotifyError() {
  return lastError;
}
export function onNotifyError(fn) {
  errorListeners.add(fn);
  return () => { errorListeners.delete(fn); };
}

// ─── Browser notifications ──────────────────────────────────────────────────

export function browserPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  const p = Notification.permission;
  return p === 'granted' || p === 'denied' ? p : 'default';
}

export async function requestBrowserPermission() {
  const now = browserPermission();
  if (now !== 'default') return now;
  try {
    await new Promise((resolve) => {
      // Older Safari only supports the callback form.
      const ret = Notification.requestPermission(resolve);
      if (ret && typeof ret.then === 'function') ret.then(resolve, resolve);
    });
  } catch { /* fall through to the current state */ }
  return browserPermission();
}

function openLink(link) {
  try { window.focus(); } catch { /* */ }
  try {
    const u = new URL(link);
    if (u.origin === location.origin && u.pathname === location.pathname) {
      if (u.hash !== location.hash) location.hash = u.hash;
    } else {
      window.open(link, '_blank', 'noopener');
    }
  } catch { /* */ }
}

const shown = new Map(); // tag → Notification, so a confirmation's alert can be closed when answered

async function showBrowser(title, body, link, tag) {
  const opts = { body };
  if (tag) opts.tag = tag;
  try {
    const n = new Notification(title, opts);
    n.onclick = () => { openLink(link); try { n.close(); } catch { /* */ } };
    if (tag) { shown.set(tag, n); n.onclose = () => { if (shown.get(tag) === n) shown.delete(tag); }; }
    return { ok: true };
  } catch {
    // Android Chrome only allows notifications through a service worker.
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg?.showNotification) { await reg.showNotification(title, { ...opts, data: { url: link } }); return { ok: true }; }
    } catch { /* */ }
    return { ok: false, error: 'This browser would not show the alert. Use the phone app instead.' };
  }
}

function closeBrowser(tag) {
  const n = tag && shown.get(tag);
  if (n) { shown.delete(tag); try { n.close(); } catch { /* */ } }
}

// ─── Publishing to ntfy ─────────────────────────────────────────────────────

function describeNtfyError(status, data) {
  if (status === 429 || (data && Math.floor(Number(data.code) / 100) === 429)) {
    return 'ntfy.sh is limiting alerts from this connection for now (it allows about 250 a day). Try again later.';
  }
  if (status === 413) return 'The alert was too long for ntfy.sh.';
  if (status >= 500) return `ntfy.sh had a problem (error ${status}). Try again later.`;
  const why = data && typeof data.error === 'string' ? `: ${data.error}` : '';
  return `ntfy.sh did not accept the alert (error ${status}${why}).`;
}

// Header-less JSON POST to the server root: a CORS "simple request", so no preflight.
async function publish(payload) {
  try {
    const res = await fetch(`${NTFY}/`, { method: 'POST', body: JSON.stringify(payload) });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) return { ok: false, error: describeNtfyError(res.status, data), data };
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Could not reach ntfy.sh. Check the internet connection.' };
  }
}

function phoneTopic(s) {
  return s.ntfy.enabled && s.ntfy.alertTopic ? s.ntfy.alertTopic : null;
}

export async function notify({ title, message, priority = 3, tags = [], url = null, event = 'system', sequenceId = null } = {}) {
  const result = { browser: false, phone: false, error: null };
  try {
    const s = loadNotifySettings();
    if (event !== 'system' && s.events[event] === false) return result;
    const t = clip(scrub(title), TITLE_MAX) || 'Promethea Programs';
    const m = clip(scrub(message), MESSAGE_MAX) || t;
    const link = resolveUrl(url);
    const seq = seqId(sequenceId);
    const errors = [];

    if (s.browser && browserPermission() === 'granted') {
      const r = await showBrowser(t, m, link, sequenceId ?? undefined);
      result.browser = r.ok;
      if (!r.ok) errors.push(r.error);
    }

    const topic = phoneTopic(s);
    if (topic && s.ntfy.replyTopic) {
      const payload = {
        topic, title: t, message: m, priority: clampPriority(priority),
        tags: Array.isArray(tags) ? tags.filter((x) => typeof x === 'string' && x).slice(0, 5).map((x) => x.slice(0, 40)) : [],
        click: link,
        actions: [{ action: 'view', label: url ? 'Open site' : 'Open desk', url: link, clear: true }],
      };
      if (seq) payload.sequence_id = seq;
      const r = await publish(payload);
      result.phone = r.ok;
      if (r.ok) setLastError(null);
      else errors.push(r.error);
    }

    if (errors.length) {
      result.error = errors.join(' ');
      setLastError(result.error);
    }
  } catch {
    result.error = 'Something went wrong while sending the alert.';
    setLastError(result.error);
  }
  return result;
}

export function sendTestNotification() {
  return notify({
    title: 'Test alert from Promethea Programs',
    message: 'Alerts are working. You will get one like this when the desk opens or closes a trade.',
    priority: 3,
    event: 'system',
    sequenceId: 'pp_test',
  });
}

// ─── Confirmations ──────────────────────────────────────────────────────────

const pending = new Map(); // id → entry
const pendingListeners = new Set();
let pendingSnapshot = [];
const seen = new Set();    // ntfy message ids already handled (no replays)

function emitPending() {
  pendingSnapshot = [...pending.values()]
    .sort((a, b) => a.expiresAt - b.expiresAt)
    .map(({ id, title, message, expiresAt }) => ({ id, title, message, expiresAt }));
  for (const fn of [...pendingListeners]) { try { fn(pendingSnapshot); } catch { /* */ } }
}

// The same array is returned until something changes (safe for useSyncExternalStore).
export function pendingConfirmations() {
  return pendingSnapshot;
}

export function onPendingConfirmations(fn) {
  pendingListeners.add(fn);
  return () => { pendingListeners.delete(fn); };
}

export function respondToConfirmation(id, decision) {
  const p = pending.get(String(id));
  if (!p || (decision !== 'confirm' && decision !== 'reject')) return false;
  if (Date.now() > p.expiresAt) { finish(p, 'timeout', 'clock'); return false; }
  return finish(p, decision, 'page');
}

function finalNote(p) {
  if (p.decision === 'timeout') return 'Trade request expired — not placed.';
  if (p.source === 'page') return p.decision === 'confirm' ? 'Answered on the site: confirmed.' : 'Answered on the site: rejected — not placed.';
  return null; // answered from the phone: the app already cleared it
}

// Replace the phone's alert (same sequence_id) so its buttons go away.
function sendFinalUpdate(p) {
  const text = finalNote(p);
  const s = loadNotifySettings();
  if (!text || !p.alertTopic || !s.ntfy.enabled || s.ntfy.alertTopic !== p.alertTopic) return;
  publish({ topic: p.alertTopic, title: p.title, message: text, priority: 2, click: p.link, sequence_id: p.seq })
    .then((r) => { if (!r.ok) setLastError(r.error); });
}

function finish(p, decision, source) {
  if (p.used) return false;
  p.used = true;
  p.decision = decision;
  p.source = source;
  clearTimeout(p.timer);
  pending.delete(p.id);
  closeBrowser(p.tag);
  emitPending();
  p.resolve(decision);
  if (p.published) sendFinalUpdate(p);
  syncStream();
  return true;
}

function sweepExpired() {
  const now = Date.now();
  for (const p of [...pending.values()]) if (now > p.expiresAt) finish(p, 'timeout', 'clock');
}

function remember(id) {
  seen.add(id);
  if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
}

// Every reply goes through here, from the live stream or from a catch-up poll.
function handleReply(msg, st) {
  if (!isObj(msg) || msg.event !== 'message' || msg.topic !== st.topic || typeof msg.id !== 'string' || !msg.id) return;
  if (seen.has(msg.id)) return;
  remember(msg.id);
  st.lastId = msg.id;
  let body;
  try { body = JSON.parse(msg.message); } catch { return; }
  if (!isObj(body) || body.v !== 1 || typeof body.t !== 'string') return;
  const p = pending.get(body.t);
  if (!p || p.used || p.replyTopic !== msg.topic || p.t0 == null) return;
  if (typeof msg.time !== 'number' || msg.time < p.t0 || msg.time > p.t0 + p.ttlSec) return;
  if (body.d !== 'confirm' && body.d !== 'reject') return;
  if (!safeEqual(body.n, p.nonces[body.d])) return;
  if (Date.now() > p.expiresAt) { finish(p, 'timeout', 'clock'); return; }
  finish(p, body.d, 'phone');
}

export function askConfirm({ id, title, message, ttlMs = DEFAULT_TTL, url = null } = {}) {
  const tid = id != null && id !== '' ? String(id) : `c${randomBase62(12)}`;
  const existing = pending.get(tid);
  if (existing) return { promise: existing.promise, respond: (d) => respondToConfirmation(tid, d) };

  const ttl = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_TTL;
  const s = loadNotifySettings();
  const usePhone = !!(phoneTopic(s) && s.ntfy.replyTopic);
  const p = {
    id: tid,
    title: clip(scrub(title), TITLE_MAX) || 'Confirm trade',
    message: clip(scrub(message), MESSAGE_MAX),
    expiresAt: Date.now() + ttl,
    ttlSec: Math.ceil(ttl / 1000),
    nonces: { confirm: randomBase62(22), reject: randomBase62(22) },
    alertTopic: usePhone ? s.ntfy.alertTopic : null,
    replyTopic: usePhone ? s.ntfy.replyTopic : null,
    link: resolveUrl(url),
    seq: seqId(`trd_${tid}`),
    tag: `trd_${tid}`,
    t0: null,
    used: false,
    published: false,
    timer: null,
  };
  p.promise = new Promise((resolve) => { p.resolve = resolve; });
  pending.set(tid, p);
  p.timer = setTimeout(() => finish(p, 'timeout', 'clock'), ttl);
  emitPending();
  ensureVisibilityHook();

  if (s.browser && browserPermission() === 'granted') {
    showBrowser(p.title, p.message || 'Open the site to confirm or reject.', p.link, p.tag).catch(() => {});
  }

  if (usePhone) {
    (async () => {
      await waitFor(syncStream(), OPEN_WAIT_MS); // listen for replies BEFORE the alert goes out
      if (p.used) return;
      const mins = Math.max(1, Math.round(ttl / 60_000));
      const tail = `Answer within ${mins} min. No answer = no trade.`;
      const body = p.message ? `${clip(p.message, MESSAGE_MAX - tail.length - 2)}\n\n${tail}` : tail;
      const reply = `${NTFY}/${p.replyTopic}`;
      const answer = (d, n) => ({
        action: 'http', label: d === 'confirm' ? 'Confirm' : 'Reject', url: reply, method: 'POST',
        headers: { Firebase: 'no' }, body: JSON.stringify({ v: 1, t: tid, d, n }), clear: true,
      });
      const sentAt = nowSec();
      const r = await publish({
        topic: p.alertTopic, title: p.title, message: body, priority: 5, tags: [],
        click: p.link, sequence_id: p.seq,
        actions: [answer('confirm', p.nonces.confirm), answer('reject', p.nonces.reject), { action: 'view', label: url ? 'Open site' : 'Open desk', url: p.link, clear: true }],
      });
      if (!r.ok) { setLastError(r.error); return; } // phone has no buttons; the site can still answer
      setLastError(null);
      p.t0 = Number.isFinite(r.data?.time) ? r.data.time : sentAt;
      p.published = true;
      if (p.used) sendFinalUpdate(p); // answered or expired while the alert was in flight
    })().catch(() => {});
  }

  return { promise: p.promise, respond: (d) => respondToConfirmation(tid, d) };
}

function waitFor(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    Promise.resolve(promise).then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(false); });
  });
}

// ─── The one shared reply stream ────────────────────────────────────────────

let stream = null; // { topic, es, lastId, since0, lastActivity, attempts, watchdog, retryTimer, openPromise, resolveOpen }

function wantedTopic() {
  const s = loadNotifySettings();
  const topic = s.ntfy.enabled ? s.ntfy.replyTopic : null;
  if (!topic) return null;
  for (const p of pending.values()) if (p.replyTopic === topic && !p.used) return topic;
  return null;
}

// Opens, keeps or closes the stream to match the pending confirmations.
// → a promise that resolves true once the stream is open (false if it is not needed).
function syncStream() {
  const topic = wantedTopic();
  if (!topic) { stopStream(); return Promise.resolve(false); }
  if (stream && stream.topic === topic) return stream.openPromise;
  stopStream();
  return startStream(topic).openPromise;
}

function startStream(topic) {
  const st = {
    topic, es: null, lastId: null, since0: nowSec() - 60, lastActivity: Date.now(),
    attempts: 0, watchdog: null, retryTimer: null, resolveOpen: null,
  };
  st.openPromise = new Promise((resolve) => { st.resolveOpen = resolve; });
  stream = st;
  connect(st, null);
  st.watchdog = setInterval(() => {
    if (stream === st && Date.now() - st.lastActivity > STALE_MS) reconnect(st);
  }, WATCHDOG_MS);
  return st;
}

function stopStream() {
  const st = stream;
  if (!st) return;
  stream = null;
  clearInterval(st.watchdog);
  clearTimeout(st.retryTimer);
  try { st.es?.close(); } catch { /* */ }
  st.es = null;
  st.resolveOpen(false);
}

function connect(st, since) {
  if (typeof EventSource === 'undefined') { st.resolveOpen(false); return; }
  const url = `${NTFY}/${st.topic}/sse${since ? `?since=${encodeURIComponent(since)}` : ''}`;
  let es;
  try { es = new EventSource(url); } catch { scheduleReconnect(st); return; }
  st.es = es;
  st.lastActivity = Date.now();
  const live = () => stream === st && st.es === es;
  // 'open' fires for the native connection and for ntfy's own named "open" event.
  es.addEventListener('open', () => {
    if (!live()) return;
    st.attempts = 0;
    st.lastActivity = Date.now();
    st.resolveOpen(true);
  });
  es.addEventListener('keepalive', () => { if (live()) st.lastActivity = Date.now(); });
  es.onmessage = (e) => {
    if (!live()) return;
    st.lastActivity = Date.now();
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleReply(msg, st);
  };
  // The browser's own retry would replay from the original URL; reconnect from the last id instead.
  es.onerror = () => { if (live()) scheduleReconnect(st); };
}

function resumeFrom(st) {
  return st.lastId ?? String(st.since0);
}

function scheduleReconnect(st) {
  if (stream !== st || st.retryTimer) return;
  try { st.es?.close(); } catch { /* */ }
  st.es = null;
  const delay = Math.min(30_000, 1000 * 2 ** st.attempts);
  st.attempts += 1;
  st.retryTimer = setTimeout(() => {
    st.retryTimer = null;
    if (stream === st) connect(st, resumeFrom(st));
  }, delay);
}

function reconnect(st) {
  if (stream !== st) return;
  clearTimeout(st.retryTimer);
  st.retryTimer = null;
  try { st.es?.close(); } catch { /* */ }
  st.es = null;
  connect(st, resumeFrom(st));
}

// One catch-up read of everything since the last reply seen (browsers pause background tabs).
async function pollOnce() {
  const st = stream;
  if (!st) return;
  try {
    const res = await fetch(`${NTFY}/${st.topic}/json?poll=1&since=${encodeURIComponent(resumeFrom(st))}`);
    if (!res.ok) return;
    const text = await res.text();
    for (const line of text.split('\n')) {
      if (!line.trim() || stream !== st) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      handleReply(msg, st);
    }
  } catch { /* the live stream will catch up */ }
}

let visibilityHooked = false;
function ensureVisibilityHook() {
  if (visibilityHooked || typeof document === 'undefined') return;
  visibilityHooked = true;
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      sweepExpired();
      const st = stream;
      if (!st) return;
      if (!st.es || st.es.readyState === 2 || Date.now() - st.lastActivity > STALE_MS) reconnect(st);
      pollOnce();
    });
  } catch { /* */ }
}

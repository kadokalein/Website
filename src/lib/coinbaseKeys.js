// Where the Live Trading page keeps the user's Coinbase API key. The key stays in
// this browser's localStorage and is only ever sent to api.coinbase.com (directly,
// or through the user's own localhost proxy).

export const KEY_STORAGE = 'pp_cb_keys_v1';
export const PROXY_KEY = 'pp_use_proxy_v1';
export const PROXY_URL = 'http://localhost:9999';

export function loadKeys() {
  try { return JSON.parse(localStorage.getItem(KEY_STORAGE) ?? 'null'); } catch { return null; }
}
export function saveKeys(k) {
  try { localStorage.setItem(KEY_STORAGE, JSON.stringify(k)); } catch { /* */ }
}
export function loadProxyPref() {
  try { return localStorage.getItem(PROXY_KEY) === 'true'; } catch { return false; }
}
export function saveProxyPref(v) {
  try { localStorage.setItem(PROXY_KEY, String(v)); } catch { /* */ }
}

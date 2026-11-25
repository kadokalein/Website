// Where the Live Trading page keeps the user's Coinbase API key. The key stays in
// this browser's localStorage and is only ever sent to api.coinbase.com (directly,
// or through the user's own localhost proxy).

import { IS_NATIVE } from './platform.js';

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

// Can signed (API-key) requests reach Coinbase from here? On the website they only work
// through the local proxy (browsers block them otherwise); the iPhone app sends them itself.
export function signedRequestsReady() {
  return IS_NATIVE || loadProxyPref();
}

// Reads the key file Coinbase lets you download (or text pasted from it).
// Handles both shapes:
//   CDP Ed25519 (default):  { "id": "<uuid>", "privateKey": "<base64>" }
//   CDP ECDSA:              { "name": "organizations/<org>/apiKeys/<key>", "privateKey": "-----BEGIN EC PRIVATE KEY-----\n…" }
// → { apiKey, apiSecret } (either may be '') or null when the text is not a key file.
export function parseCoinbaseKeyJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a >= 0 && b > a) { try { obj = JSON.parse(raw.slice(a, b + 1)); } catch { /* not JSON */ } }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const str = (...keys) => {
    for (const k of keys) if (typeof obj[k] === 'string' && obj[k].trim()) return obj[k].trim();
    return '';
  };
  const name = str('name', 'keyName', 'key_name', 'apiKeyName', 'api_key_name');
  const id = str('id', 'apiKeyId', 'api_key_id', 'keyId', 'key_id', 'apiKey', 'api_key');
  // The full "organizations/…/apiKeys/…" name wins; otherwise the id (new Ed25519 files only have "id").
  const apiKey = name.startsWith('organizations/') ? name : (id || name);
  const apiSecret = str('privateKey', 'private_key', 'apiKeySecret', 'apiSecret', 'api_secret', 'secret')
    .replace(/\\r/g, '').replace(/\\n/g, '\n');
  if (!apiKey && !apiSecret) return null;
  return { apiKey, apiSecret };
}

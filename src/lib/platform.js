// Where this code is running: the website in a browser, or the iPhone app (Capacitor).
// The app is the same site packaged with Capacitor; the differences live here and in
// src/lib/nativeApp.js.

import { Capacitor, CapacitorHttp } from '@capacitor/core';

export const IS_NATIVE = Capacitor.isNativePlatform();
export const IS_IOS_APP = IS_NATIVE && Capacitor.getPlatform() === 'ios';

// The public website, for links that have to work outside the app.
export const PUBLIC_SITE = 'https://kadokalein.github.io/Website/';

// URL scheme registered in ios/App/App/Info.plist (CFBundleURLTypes). Opening
// prometheaprograms://open/#/desk opens the app on the Trading Desk.
export const APP_SCHEME = 'prometheaprograms';

// Absolute link to a page of this app, e.g. pageLink('#/live'), for notifications.
// In the iPhone app it is an app link, so tapping the alert opens the app itself.
export function pageLink(hash = '#/desk') {
  const h = String(hash || '#/desk').startsWith('#') ? String(hash || '#/desk') : `#${hash}`;
  if (IS_NATIVE) return `${APP_SCHEME}://open/${h}`;
  if (typeof location === 'undefined' || !location.origin || location.origin === 'null') return `${PUBLIC_SITE}${h}`;
  return `${location.origin}${import.meta.env.BASE_URL}${h}`;
}

// HTTP request made by iOS itself instead of the web view. Browsers block signed
// cross-origin calls to api.coinbase.com (CORS), which is why the website needs the
// local proxy; requests sent by the app's native code are not subject to CORS. Coinbase
// also refuses its public market API to the app's web view (origin capacitor://localhost),
// so the app sends those requests this way too (src/lib/coinbaseMarket.js).
//   body — a string, sent byte for byte (Capacitor passes strings through unchanged)
// → { ok, status, text, headers } (header names lower-case). Network failures throw, like fetch().
// iOS parses JSON responses before handing them over, so `text` is re-serialised JSON: same
// values, but object keys may come back in a different order.
export async function nativeRequest(url, { method = 'GET', headers = {}, body, timeoutMs = 30_000 } = {}) {
  const res = await CapacitorHttp.request({
    url,
    method,
    headers,
    data: body === undefined || body === null || body === '' ? undefined : String(body),
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
    responseType: 'text',
  });
  // iOS parses JSON responses itself; turn them back into text so callers parse one way.
  const d = res.data;
  const text = typeof d === 'string' ? d : d === undefined || d === null ? '' : JSON.stringify(d);
  const resHeaders = {};
  for (const [k, v] of Object.entries(res.headers ?? {})) resHeaders[k.toLowerCase()] = String(v);
  return { ok: res.status >= 200 && res.status < 300, status: res.status, text, headers: resHeaders };
}

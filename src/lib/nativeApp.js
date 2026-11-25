// Behaviour that only exists in the iPhone app: opening app links from alerts, keeping
// the screen on while the desk runs, and catching up when the app comes back to the front.
// On the website every export here is a no-op.

import { App } from '@capacitor/app';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { IS_NATIVE, APP_SCHEME } from './platform.js';

const KEY = 'pp_native_v1';
const DEFAULTS = { keepAwake: true };
const listeners = new Set();
let current = null;

function read() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; }
}

// Stable snapshot (same object until it changes), so it works with useSyncExternalStore.
export function nativeSettings() {
  if (!current) current = read();
  return current;
}

export function onNativeSettings(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function saveNativeSettings(patch) {
  current = { ...nativeSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* storage full or blocked */ }
  applyKeepAwake();
  listeners.forEach((fn) => fn());
}

// iOS pauses an app's JavaScript soon after it leaves the screen, and the screen locks
// itself after a while — so the desk (and automatic trading) only runs while the app is on
// screen. Keeping the screen on lets a phone on a charger keep the desk running.
async function applyKeepAwake() {
  if (!IS_NATIVE) return;
  try {
    if (nativeSettings().keepAwake) await KeepAwake.keepAwake();
    else await KeepAwake.allowSleep();
  } catch { /* plugin missing in an old build — nothing to do */ }
}

// prometheaprograms://open/#/live → '#/live' (only plain page paths are accepted).
export function hashFromAppUrl(url) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/open\/(#\/[A-Za-z0-9/_\-.?=&%]*)$/i.exec(String(url ?? ''));
  return m && m[1].toLowerCase() === APP_SCHEME ? m[2] : null;
}

let started = false;
export function startNativeApp() {
  if (!IS_NATIVE || started) return;
  started = true;
  applyKeepAwake();

  // Tapping an alert's link opens the app on that page.
  App.addListener('appUrlOpen', ({ url }) => {
    const hash = hashFromAppUrl(url);
    if (hash && hash !== window.location.hash) window.location.hash = hash;
    if (import.meta.env.VITE_NATIVE_SELFTEST === '1') console.log(`[selftest] app link opened ${hash ?? '(ignored)'}`);
  }).catch(() => {});

  // Back in front: re-apply keep-awake and let the desk and the alert listener catch up at once
  // (they already listen for visibilitychange; this makes sure it fires after iOS resumes the app).
  App.addListener('resume', () => {
    applyKeepAwake();
    try { document.dispatchEvent(new Event('visibilitychange')); } catch { /* */ }
  }).catch(() => {});

  // Only in the build GitHub Actions makes to test the app in the iPhone simulator.
  if (import.meta.env.VITE_NATIVE_SELFTEST === '1') {
    import('./nativeSelfTest.js').then((m) => m.runNativeSelfTest()).catch((e) => console.log(`[selftest] FAIL could not start: ${e?.message ?? e}`));
  }
}

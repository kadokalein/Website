// Coinbase cash balance for the Briefing, using the key saved on the Live Trading page.

import { createCoinbaseClient } from '../../lib/coinbaseApi.js';
import { loadKeys, loadProxyPref, PROXY_URL } from '../../lib/coinbaseKeys.js';

// → { connected: false }
//   { connected: true, ok: true, cash, assets }
//   { connected: true, ok: false, error }
export async function fetchCoinbaseBalance() {
  const keys = loadKeys();
  if (!keys?.apiKey || !keys?.apiSecret) return { connected: false };
  // Authenticated Coinbase calls are CORS-blocked from a web page; they only work through the local proxy.
  if (!loadProxyPref()) return { connected: true, ok: false, error: 'Local proxy is switched off on the Live page' };
  try {
    const client = createCoinbaseClient(keys.apiKey, keys.apiSecret, PROXY_URL);
    const data = await client.getAccounts();
    let cash = 0, assets = 0;
    for (const a of data?.accounts ?? []) {
      const v = Number(a.available_balance?.value ?? 0);
      if (!(v > 0)) continue;
      if (a.currency === 'USD' || a.currency === 'USDC') cash += v; else assets += 1;
    }
    return { connected: true, ok: true, cash, assets };
  } catch (e) {
    return { connected: true, ok: false, error: String(e?.message ?? e).slice(0, 160) };
  }
}

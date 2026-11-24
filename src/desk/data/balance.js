// Coinbase cash balance for the Briefing, using the key saved on the Live Trading page.

import {
  createCoinbaseClient, checkProxy, detectKeyType, describeCoinbaseError, CoinbaseError,
} from '../../lib/coinbaseApi.js';
import { loadKeys, loadProxyPref, PROXY_URL } from '../../lib/coinbaseKeys.js';

// → { connected: false }
//   { connected: true, ok: true, cash, assets }
//   { connected: true, ok: false, error, kind, title, steps, keyType }
//     error — one actionable sentence (same wording as the Live page); kind — see CoinbaseError
export async function fetchCoinbaseBalance() {
  const keys = loadKeys();
  if (!keys?.apiKey || !keys?.apiSecret) return { connected: false };
  const keyType = detectKeyType(keys.apiSecret);
  const fail = (e) => {
    const d = describeCoinbaseError(e, { keyType, proxyUrl: PROXY_URL });
    return { connected: true, ok: false, error: d.summary, kind: d.kind, title: d.title, steps: d.steps, keyType };
  };
  // Authenticated Coinbase calls are CORS-blocked from a web page; they only work through the local proxy.
  if (!loadProxyPref()) return fail(new CoinbaseError('proxy_off'));
  try {
    await checkProxy(PROXY_URL);
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
    return fail(e);
  }
}

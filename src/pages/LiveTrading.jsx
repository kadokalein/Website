import { useState, useEffect, useEffectEvent, useCallback, useMemo } from 'react';
import AppNav from '../components/AppNav';
import LiveAutoTradePanel from '../desk/ui/LiveAutoTradePanel';
import {
  createCoinbaseClient, detectKeyType, keyTypeLabel, normalizeSecret, normalizeKeyName,
  checkProxy, describeCoinbaseError, CoinbaseError,
} from '../lib/coinbaseApi';
import { KEY_STORAGE, PROXY_URL, loadKeys, saveKeys, loadProxyPref, saveProxyPref, parseCoinbaseKeyJson, signedRequestsReady } from '../lib/coinbaseKeys'
import { IS_NATIVE, nativeRequest } from '../lib/platform';
import { fetchCandles } from '../utils/binanceApi';
import { analyzeCandles } from '../utils/indicators';
import { computeRunScore } from '../utils/scoring';
import { SCAN_UNIVERSE } from '../constants';

const STATE_STORAGE = 'pp_live_state_v1';

const POSITION_SIZE = 0.15;
const MAX_POSITIONS = 4;
const PRICE_REFRESH = 90_000; // 90s between price checks

function loadLiveState() {
  try { return JSON.parse(localStorage.getItem(STATE_STORAGE) ?? 'null'); } catch { return null; }
}
function saveLiveState(s) {
  try { localStorage.setItem(STATE_STORAGE, JSON.stringify(s)); } catch { /* */ }
}

function formatUSD(v) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v ?? 0);
}
function formatPrice(price) {
  if (price == null) return '—';
  if (price >= 1000) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price);
  if (price >= 1) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(price);
}

function SignalBadge({ signal }) {
  const cfg = {
    'BUY TRIGGERED': 'bg-green-500/15 text-green-300 border-green-500/30',
    'WATCH':         'bg-yellow-500/10 text-yellow-400 border-yellow-500/25',
    'LOW QUALITY':   'bg-blue-500/10 text-blue-400 border-blue-500/25',
    'NO SIGNAL':     'bg-[#30363d] text-[#484f58] border-[#484f58]/30',
  }[signal] ?? 'bg-[#30363d] text-[#484f58] border-[#484f58]/30';
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cfg}`}>{signal}</span>;
}

export default function LiveTrading() {
  const [keys, setKeys]           = useState(() => loadKeys());
  const [keyInput, setKeyInput]   = useState({ apiKey: '', apiSecret: '' });
  const [jsonPaste, setJsonPaste] = useState('');
  const [showSetup, setShowSetup] = useState(!loadKeys());
  const [useProxy, setUseProxy]   = useState(() => loadProxyPref());
  const [accounts, setAccounts]   = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError]     = useState(null);

  const [prices, setPrices]   = useState({});
  const [scores, setScores]   = useState({});
  const [livePositions, setLivePositions] = useState(() => loadLiveState()?.positions ?? {});
  const [liveOrders, setLiveOrders]       = useState([]);
  const [refreshing, setRefreshing]       = useState(false);
  const [actionStatus, setActionStatus]   = useState(null); // { msg, ok }

  const client = useMemo(
    () => (keys ? createCoinbaseClient(keys.apiKey, keys.apiSecret, useProxy ? PROXY_URL : null) : null),
    [keys, useProxy],
  );

  // Persist live positions
  useEffect(() => {
    saveLiveState({ positions: livePositions });
  }, [livePositions]);

  const setStatus = (msg, ok = true) => {
    setActionStatus({ msg, ok });
    setTimeout(() => setActionStatus(null), 5000);
  };

  // Auto-parse the JSON key file downloaded from the Coinbase Developer Platform
  // ({"id","privateKey"} for Ed25519 keys, {"name","privateKey"} for ECDSA keys)
  function handleJsonPaste(raw) {
    setJsonPaste(raw);
    const parsed = parseCoinbaseKeyJson(raw);
    if (parsed) setKeyInput(parsed);
  }

  const inputKeyType = detectKeyType(keyInput.apiSecret);

  // Save keys
  function handleSaveKeys(e) {
    e.preventDefault();
    const trimmed = { apiKey: normalizeKeyName(keyInput.apiKey), apiSecret: normalizeSecret(keyInput.apiSecret) };
    if (!trimmed.apiKey || !trimmed.apiSecret) return;
    const type = detectKeyType(trimmed.apiSecret);
    if (!type) {
      setStatus('That private key is not recognised — paste the privateKey value from the JSON file Coinbase gave you.', false);
      return;
    }
    saveKeys(trimmed);
    setKeys(trimmed);
    setShowSetup(false);
    setJsonPaste('');
    setAccountsError(null);
    setStatus(`${keyTypeLabel(type)} key saved — never sent to any server other than api.coinbase.com`);
  }

  function handleClearKeys() {
    if (!confirm(IS_NATIVE ? 'Remove Coinbase API keys from this app?' : 'Remove Coinbase API keys from this browser?')) return;
    localStorage.removeItem(KEY_STORAGE);
    setKeys(null);
    setShowSetup(true);
    setAccounts([]);
  }

  // Test raw connectivity (no auth) first, then the signed call — separates network problems from key problems
  async function testConnection() {
    setStatus('Testing connection…', true);
    try {
      // Public unauthenticated endpoint
      // The iPhone app sends it through iOS: Coinbase refuses its public API to the app's web view.
      const url = 'https://api.coinbase.com/api/v3/brokerage/market/products?limit=1';
      const r = IS_NATIVE ? await nativeRequest(url, { timeoutMs: 15_000 }) : await fetch(url);
      if (r.ok || r.status === 401) {
        setStatus('Coinbase is reachable ✓ — now testing your API key…', true);
      } else {
        setStatus(`Coinbase public API returned HTTP ${r.status} — testing your API key anyway…`, false);
      }
    } catch (e) {
      setStatus(`Could not reach api.coinbase.com from this ${IS_NATIVE ? 'app' : 'browser'} (${e.message ?? e}) — check your internet connection${IS_NATIVE ? '' : ' or ad blocker'}. Testing your API key anyway…`, false);
    }
    fetchAccounts();
  }

  // Fetch Coinbase account balances
  async function fetchAccounts() {
    if (!client) return;
    setAccountsLoading(true);
    setAccountsError(null);
    const keyType = detectKeyType(keys?.apiSecret);
    try {
      // Signed calls are CORS-blocked straight from a web page; they only work through the local proxy.
      // The iPhone app sends them itself, so it needs no proxy.
      if (!IS_NATIVE && !useProxy) throw new CoinbaseError('proxy_off');
      await checkProxy(PROXY_URL);
      const data = await client.getAccounts();
      const relevant = (data.accounts ?? [])
        .filter(a => parseFloat(a.available_balance?.value ?? 0) > 0)
        .sort((a, b) => parseFloat(b.available_balance?.value ?? 0) - parseFloat(a.available_balance?.value ?? 0));
      setAccounts(relevant);
      if (relevant.length === 0) setStatus(`Connected ✓ (${keyTypeLabel(keyType)} key) — no balances above zero on this account.`, true);
    } catch (e) {
      setAccountsError(describeCoinbaseError(e, { keyType, proxyUrl: PROXY_URL }));
    } finally {
      setAccountsLoading(false);
    }
  }

  // Auto-fetch only when signed calls can work (proxy pref saved, or the iPhone app)
  const autoLoadAccounts = useEffectEvent(() => {
    if (signedRequestsReady()) fetchAccounts();
  });
  useEffect(() => {
    if (keys && !showSetup) autoLoadAccounts();
  }, [keys, showSetup]);

  // Fetch recent orders from Coinbase
  const fetchOrders = useCallback(async () => {
    if (!client) return;
    try {
      const data = await client.listOrders({ limit: 20 });
      setLiveOrders(data.orders ?? []);
    } catch { /* silent */ }
  }, [client]);

  // Price/score refresh
  const refreshPrices = useCallback(async () => {
    setRefreshing(true);
    const symbols = new Set([
      ...Object.keys(livePositions),
      ...SCAN_UNIVERSE.slice(0, 15).map(c => c.symbol),
    ]);
    const fp = {}, fs = {};
    await Promise.allSettled([...symbols].map(async symbol => {
      try {
        const { candles, interval } = await fetchCandles(symbol, '4H');
        const analysis = analyzeCandles(candles, interval);
        fp[symbol] = analysis.currentPrice;
        fs[symbol] = computeRunScore(analysis);
      } catch { /* */ }
    }));
    setPrices(p => ({ ...p, ...fp }));
    setScores(p => ({ ...p, ...fs }));
    setRefreshing(false);
  }, [livePositions]);

  // Periodic refresh
  useEffect(() => {
    if (!keys) return;
    const timer = setInterval(() => { refreshPrices(); }, PRICE_REFRESH);
    return () => clearInterval(timer);
  }, [keys, refreshPrices]);

  // Initial load
  const initialLoad = useEffectEvent(() => {
    if (keys) { refreshPrices(); fetchOrders(); }
  });
  useEffect(() => {
    const t = setTimeout(initialLoad, 0);
    return () => clearTimeout(t);
  }, []);

  // Manual place market buy
  async function manualBuy(symbol) {
    if (!client) return;
    const usdAccount = accounts.find(a => a.currency === 'USD' || a.currency === 'USDC');
    const cash = parseFloat(usdAccount?.available_balance?.value ?? 0);
    const spend = cash * POSITION_SIZE;
    if (spend < 5) { setStatus('Insufficient balance (need ≥ $5)', false); return; }
    try {
      const orderId = `manual-buy-${symbol}-${Date.now()}`;
      await client.placeMarketBuy(orderId, `${symbol}-USDC`, String(spend.toFixed(2)));
      const price = prices[symbol];
      if (price) {
        setLivePositions(p => ({
          ...p,
          [symbol]: { qty: spend / price, entryPrice: price, entryTime: new Date().toISOString(), entryScore: scores[symbol]?.score ?? 0 },
        }));
      }
      setStatus(`BUY order placed: ${symbol}`, true);
      fetchAccounts(); fetchOrders();
    } catch (e) {
      setStatus(`Buy failed: ${e.message}`, false);
    }
  }

  async function manualSell(symbol) {
    if (!client) return;
    const pos = livePositions[symbol];
    if (!pos) return;
    try {
      const orderId = `manual-sell-${symbol}-${Date.now()}`;
      // Coinbase takes its fee out of a buy, so the coin actually held is a little
      // less than the amount recorded here — never try to sell more than is held.
      const held = parseFloat(accounts.find(a => a.currency === symbol)?.available_balance?.value ?? 'NaN');
      const size = Number.isFinite(held) && held > 0 ? Math.min(pos.qty, held) : pos.qty;
      await client.placeMarketSell(orderId, `${symbol}-USDC`, String(Math.floor(size * 1e8) / 1e8));
      setLivePositions(p => { const n = { ...p }; delete n[symbol]; return n; });
      setStatus(`SELL order placed: ${symbol}`, true);
      fetchAccounts(); fetchOrders();
    } catch (e) {
      setStatus(`Sell failed: ${e.message}`, false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <AppNav
        badge={{ text: 'REAL MONEY', tone: 'red' }}
        actions={(
          <button
            onClick={() => refreshPrices()}
            disabled={refreshing || !keys}
            className="px-3 py-1.5 rounded-md text-xs bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white transition-colors disabled:opacity-40"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Warning banner */}
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 flex gap-3">
          <span className="text-red-400 text-lg flex-shrink-0">⚠</span>
          <div className="text-sm text-red-300">
            <strong>This page places real orders on Coinbase using your API key.</strong> Only trade with money you can afford to lose.
            Your API keys are stored in <em>{IS_NATIVE ? "this app's storage on this phone only" : "this browser's localStorage only"}</em> and are never sent to any server other than <code className="text-red-200">api.coinbase.com</code>.
          </div>
        </div>

        {/* API Key setup */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-semibold text-white">Coinbase API Credentials</div>
            {keys && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                  <span className="text-green-400">{keyTypeLabel(detectKeyType(keys.apiSecret))} key saved</span>
                </span>
                <button onClick={() => setShowSetup(s => !s)} className="text-xs text-[#8b949e] hover:text-white px-2 py-1 rounded border border-[#30363d]">
                  {showSetup ? 'Hide' : 'Edit'}
                </button>
                <button onClick={handleClearKeys} className="text-xs text-red-400 px-2 py-1 rounded border border-red-500/30">Remove</button>
              </div>
            )}
          </div>

          {showSetup && (
            <form onSubmit={handleSaveKeys} className="space-y-3 mt-3">

              {/* How-to instructions */}
              <div className="rounded-lg bg-[#0d1117] border border-[#30363d] p-3 text-[11px] text-[#8b949e] space-y-1.5">
                <div className="font-semibold text-white text-xs">How to get your credentials</div>
                <div><span className="text-[#58a6ff]">1.</span> Go to <strong className="text-white">coinbase.com → Settings → API</strong></div>
                <div><span className="text-[#58a6ff]">2.</span> Click <strong className="text-white">"Advanced API"</strong> (top right of that page) → Coinbase Developer Platform opens</div>
                <div><span className="text-[#58a6ff]">3.</span> Click <strong className="text-white">"Create API key"</strong> → give it the <em>View</em> permission (and <em>Trade</em> to place orders). Leave the IP allowlist empty unless you know this computer's public IP.</div>
                <div><span className="text-[#58a6ff]">4.</span> <strong className="text-white">Download the JSON file</strong>. Ed25519 keys (the default) contain <code className="text-green-300">id</code> and <code className="text-green-300">privateKey</code>; ECDSA keys contain <code className="text-green-300">name</code> and <code className="text-green-300">privateKey</code>. Both work.</div>
                <div><span className="text-[#58a6ff]">5.</span> Open the file in a text editor and paste all of it below — the fields fill automatically</div>
              </div>

              {/* JSON paste shortcut */}
              <div>
                <label className="text-[10px] text-[#484f58] uppercase font-semibold tracking-widest block mb-1">
                  Paste credentials JSON (easiest)
                </label>
                <textarea
                  rows={4}
                  placeholder={'{\n  "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",\n  "privateKey": "base64…=="\n}\n— or —\n{\n  "name": "organizations/…/apiKeys/…",\n  "privateKey": "-----BEGIN EC PRIVATE KEY-----\\n…"\n}'}
                  value={jsonPaste}
                  onChange={e => handleJsonPaste(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-[11px] text-[#8b949e] font-mono placeholder-[#30363d] focus:outline-none focus:border-[#58a6ff] resize-none"
                />
                {jsonPaste.length > 10 && (
                  <div className="mt-1.5 rounded bg-[#0d1117] border border-[#30363d] px-2 py-1.5 text-[10px] space-y-0.5">
                    <div>
                      <span className="text-[#484f58]">Key name / id: </span>
                      <span className={keyInput.apiKey ? 'text-green-400' : 'text-red-400'}>
                        {keyInput.apiKey ? keyInput.apiKey.slice(0, 60) + (keyInput.apiKey.length > 60 ? '…' : '') : '— not detected'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#484f58]">Private key: </span>
                      <span className={inputKeyType === 'ed25519' || inputKeyType === 'ecdsa' ? 'text-green-400' : keyInput.apiSecret ? 'text-yellow-400' : 'text-red-400'}>
                        {!keyInput.apiSecret ? '— not detected'
                          : inputKeyType ? `✓ ${keyTypeLabel(inputKeyType)} detected`
                          : 'not recognised — paste the whole privateKey value'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 text-[10px] text-[#484f58]">
                <div className="flex-1 h-px bg-[#30363d]" />
                or enter manually
                <div className="flex-1 h-px bg-[#30363d]" />
              </div>

              {/* Manual entry */}
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-[#484f58] uppercase font-semibold tracking-widest block mb-1">
                    Key Name / ID <span className="normal-case font-normal">(the <code>name</code> field, <code>organizations/…/apiKeys/…</code> — or the <code>id</code> field of an Ed25519 key file)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="organizations/{org_id}/apiKeys/{key_id}  or  xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={keyInput.apiKey}
                    onChange={e => setKeyInput(p => ({ ...p, apiKey: e.target.value }))}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-sm text-white font-mono placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff]"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#484f58] uppercase font-semibold tracking-widest block mb-1">
                    Private Key <span className="normal-case font-normal">(the <code>privateKey</code> field — a base64 string for Ed25519 keys, or text starting with <code>-----BEGIN</code> for ECDSA keys)</span>
                  </label>
                  <textarea
                    rows={4}
                    placeholder={"Ed25519: base64…==\n— or —\n-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----"}
                    value={keyInput.apiSecret}
                    onChange={e => setKeyInput(p => ({ ...p, apiSecret: e.target.value }))}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-[11px] text-white font-mono placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff] resize-none"
                  />
                </div>
              </div>

              {keyInput.apiKey && keyInput.apiSecret && (
                <div className="text-[10px] text-[#484f58]">
                  Detected: <span className={`font-semibold ${inputKeyType ? 'text-white' : 'text-yellow-400'}`}>{inputKeyType ? `${keyTypeLabel(inputKeyType)} ✓` : 'unrecognised private key'}</span>
                  {inputKeyType === 'hmac' && <span> — legacy keys may no longer be accepted; a new CDP key (JSON file) is recommended.</span>}
                </div>
              )}

              <button type="submit" disabled={!keyInput.apiKey.trim() || !inputKeyType}
                className="w-full px-4 py-2 rounded-md bg-[#1f6feb] hover:bg-[#388bfd] disabled:opacity-40 text-white text-sm font-medium transition-colors">
                Save Credentials
              </button>
            </form>
          )}
        </div>

        {/* Status toast */}
        {actionStatus && (
          <div className={`rounded-lg px-4 py-2 text-sm font-medium ${actionStatus.ok ? 'bg-green-500/15 text-green-300 border border-green-500/30' : 'bg-red-500/15 text-red-400 border border-red-500/30'}`}>
            {actionStatus.msg}
          </div>
        )}

        {keys && (
          <>
            {/* Account balances */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-white">Account Balances</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {IS_NATIVE ? (
                    <span className="text-xs px-2 py-1 rounded border bg-green-500/15 border-green-500/30 text-green-400"
                      title="The iPhone app sends signed requests to api.coinbase.com itself, so no proxy is needed">Direct ✓</span>
                  ) : (
                  <button
                    onClick={() => setUseProxy(v => { saveProxyPref(!v); return !v; })}
                    title="Route requests through a local proxy on localhost:9999 to bypass browser CORS restrictions"
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      useProxy
                        ? 'bg-green-500/15 border-green-500/30 text-green-400'
                        : 'border-[#30363d] text-[#484f58] hover:text-[#8b949e]'
                    }`}
                  >
                    {useProxy ? 'Proxy ✓' : 'Proxy off'}
                  </button>
                  )}
                  <button onClick={testConnection} className="text-xs text-[#58a6ff] hover:text-white px-2 py-1 rounded border border-[#58a6ff]/30 hover:border-[#58a6ff]">
                    Test
                  </button>
                  <button onClick={fetchAccounts} disabled={accountsLoading} className="text-xs text-[#8b949e] hover:text-white px-2 py-1 rounded border border-[#30363d] disabled:opacity-40">
                    {accountsLoading ? '…' : 'Load'}
                  </button>
                </div>
              </div>

              {accountsError ? (
                <div className={`rounded-lg border p-3 text-[11px] space-y-2 ${accountsError.kind === 'auth' || accountsError.kind === 'key_invalid' || accountsError.kind === 'http' ? 'border-red-500/30 bg-red-500/5 text-red-300' : 'border-yellow-500/30 bg-yellow-500/5 text-yellow-300'}`}>
                  <div className="font-semibold text-sm">⚠ {accountsError.title}</div>
                  <div>{accountsError.summary}</div>
                  {accountsError.steps.length > 0 && (
                    <ol className="list-decimal pl-4 space-y-1 text-[#c9d1d9]">
                      {accountsError.steps.map(step => <li key={step}>{step}</li>)}
                    </ol>
                  )}
                  {!IS_NATIVE && accountsError.kind.startsWith('proxy_') && accountsError.kind !== 'proxy_upstream' && (
                    <>
                      <div className="rounded bg-[#0d1117] border border-[#30363d] px-3 py-2 font-mono text-[10px] text-green-300 select-all whitespace-pre-wrap">
                        {'cd ~/Downloads\nnode cors-proxy.js'}
                      </div>
                      <div className="text-[10px] text-[#8b949e]">
                        The proxy runs only on your computer and just relays the requests this page signs to api.coinbase.com. If you downloaded cors-proxy.js before, download it again — the new version is stricter about which sites may use it.
                        Safari may block this page from calling localhost; if it still can't connect after the proxy is running, use Chrome or Firefox.
                      </div>
                      <a
                        href={`${import.meta.env.BASE_URL}cors-proxy.js`}
                        download="cors-proxy.js"
                        className="inline-block px-3 py-1.5 rounded text-xs font-medium bg-[#21262d] border border-[#30363d] text-white hover:bg-[#30363d] transition-colors"
                      >
                        ↓ Download cors-proxy.js
                      </a>
                    </>
                  )}
                  {accountsError.detail && (
                    <div className="rounded bg-black/30 px-2 py-1 font-mono text-[10px] text-[#8b949e] break-all">
                      Details: {accountsError.detail}
                    </div>
                  )}
                  <div className="pt-1 flex flex-wrap items-center gap-3">
                    {!IS_NATIVE && !useProxy && (
                      <button
                        onClick={() => { setUseProxy(true); saveProxyPref(true); setAccountsError(null); }}
                        className="px-3 py-1.5 rounded text-xs font-medium border transition-colors bg-[#21262d] border-[#30363d] text-[#8b949e] hover:text-white"
                      >
                        Turn on proxy (localhost:9999)
                      </button>
                    )}
                    {(accountsError.kind === 'auth' || accountsError.kind === 'key_invalid') && (
                      <button onClick={() => setShowSetup(true)}
                        className="px-3 py-1.5 rounded text-xs font-medium bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white">
                        Edit API key
                      </button>
                    )}
                    <button onClick={fetchAccounts} disabled={accountsLoading}
                      className="px-3 py-1.5 rounded text-xs font-medium bg-[#1f6feb] text-white hover:bg-[#388bfd] disabled:opacity-40">
                      {accountsLoading ? 'Loading…' : 'Retry load'}
                    </button>
                  </div>
                </div>
              ) : accounts.length === 0 && !accountsLoading ? (
                <div className="text-[#484f58] text-sm">Click "Load" to fetch your Coinbase balances.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {accounts.slice(0, 9).map(acc => (
                    <div key={acc.uuid} className="bg-[#0d1117] rounded-lg px-3 py-2">
                      <div className="text-xs font-semibold text-white">{acc.currency}</div>
                      <div className="text-sm font-mono text-[#58a6ff]">{parseFloat(acc.available_balance?.value ?? 0).toFixed(acc.currency === 'USD' || acc.currency === 'USDC' ? 2 : 6)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <LiveAutoTradePanel />

            {/* Tracked positions */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#30363d]">
                <div className="text-sm font-semibold text-white">Tracked Positions ({Object.keys(livePositions).length})</div>
                <div className="text-[10px] text-[#484f58] mt-0.5">Positions placed by this app — does not include orders placed elsewhere</div>
              </div>
              {Object.keys(livePositions).length === 0 ? (
                <div className="px-4 py-6 text-center text-[#484f58] text-sm">No tracked positions.</div>
              ) : (
                <div className="divide-y divide-[#30363d]">
                  {Object.entries(livePositions).map(([symbol, pos]) => {
                    const price = prices[symbol] ?? pos.entryPrice;
                    const pnlPctVal = ((price - pos.entryPrice) / pos.entryPrice) * 100;
                    const rs = scores[symbol];
                    return (
                      <div key={symbol} className="px-4 py-3 flex flex-wrap items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#21262d] flex items-center justify-center text-xs font-bold text-orange-400">
                          {symbol.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-[100px]">
                          <div className="text-sm font-semibold text-white">{symbol}</div>
                          <div className="text-[10px] text-[#484f58]">Entry {formatPrice(pos.entryPrice)} · Score {pos.entryScore}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-mono text-white">{formatPrice(price)}</div>
                          <div className={`text-[10px] font-mono ${pnlPctVal >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {pnlPctVal >= 0 ? '+' : ''}{pnlPctVal.toFixed(2)}%
                          </div>
                        </div>
                        {rs && <SignalBadge signal={rs.signal} />}
                        <button onClick={() => manualSell(symbol)} className="px-3 py-1 rounded bg-red-500/15 border border-red-500/30 text-red-400 text-xs hover:bg-red-500/25">
                          Sell
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Top signals */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#30363d]">
                <div className="text-sm font-semibold text-white">Top Signals</div>
              </div>
              {Object.keys(scores).length === 0 ? (
                <div className="px-4 py-6 text-center text-[#484f58] text-sm">Loading market data…</div>
              ) : (
                <div className="divide-y divide-[#30363d]">
                  {Object.entries(scores)
                    .filter(([, rs]) => rs?.score >= 40)
                    .sort((a, b) => (b[1]?.score ?? 0) - (a[1]?.score ?? 0))
                    .slice(0, 8)
                    .map(([symbol, rs]) => {
                      const held = livePositions[symbol];
                      const canBuy = !held && Object.keys(livePositions).length < MAX_POSITIONS;
                      return (
                        <div key={symbol} className="px-4 py-2.5 flex flex-wrap items-center gap-3">
                          <div className="flex-1 min-w-[100px]">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-white">{symbol}</span>
                              <SignalBadge signal={rs?.signal} />
                            </div>
                            <div className="text-[10px] text-[#484f58]">Score {rs?.score}/100</div>
                          </div>
                          <div className="text-sm font-mono text-white">{formatPrice(prices[symbol])}</div>
                          {held ? (
                            <span className="text-[10px] text-[#484f58] px-2 py-1 rounded bg-[#21262d]">Held</span>
                          ) : (
                            <button
                              onClick={() => manualBuy(symbol)}
                              disabled={!canBuy || !prices[symbol]}
                              className="px-3 py-1 rounded bg-orange-500/15 border border-orange-500/30 text-orange-300 text-xs hover:bg-orange-500/25 disabled:opacity-30"
                            >
                              Buy 15%
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Coinbase order history */}
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#30363d] flex items-center justify-between">
                <div className="text-sm font-semibold text-white">Coinbase Order History</div>
                <button onClick={fetchOrders} className="text-xs text-[#8b949e] hover:text-white px-2 py-1 rounded border border-[#30363d]">Refresh</button>
              </div>
              {liveOrders.length === 0 ? (
                <div className="px-4 py-6 text-center text-[#484f58] text-sm">No orders found.</div>
              ) : (
                <div className="divide-y divide-[#30363d] max-h-64 overflow-y-auto">
                  {liveOrders.map(order => {
                    const filled = parseFloat(order.filled_size ?? 0);
                    const avg    = parseFloat(order.average_filled_price ?? 0);
                    const total  = filled * avg;
                    const side   = order.side;
                    return (
                      <div key={order.order_id} className="px-4 py-2.5 flex items-center gap-3">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${side === 'BUY' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                          {side}
                        </span>
                        <span className="text-sm font-semibold text-white w-20">{order.product_id?.replace('-USDC','')}</span>
                        <span className="text-[11px] text-[#8b949e] font-mono">{avg > 0 ? formatPrice(avg) : '—'}</span>
                        <span className="text-[11px] text-[#8b949e] font-mono ml-auto">{total > 0 ? formatUSD(total) : '—'}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${order.status === 'FILLED' ? 'text-green-400' : 'text-[#484f58]'}`}>
                          {order.status}
                        </span>
                        <span className="text-[10px] text-[#484f58] hidden sm:block">
                          {order.created_time ? new Date(order.created_time).toLocaleTimeString() : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {!keys && (
          <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-8 text-center">
            <div className="text-[#484f58] text-4xl mb-3">🔑</div>
            <div className="text-white font-semibold mb-1">Enter your Coinbase API keys above to get started</div>
            <div className="text-[#8b949e] text-sm">Keys are stored only in your browser — never on any server</div>
          </div>
        )}

      </main>
    </div>
  );
}

// Portfolio settings: the free Twelve Data key the desk uses for stock charts.
import { useState } from 'react';
import { useDesk } from '../DeskProvider';
import { loadTdKey } from '../../lib/twelveData';
import { Badge, Card, BTN } from './atoms';
import { timeAgo } from './format';

const INPUT = 'w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-sm text-white font-mono placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff]';

export default function StockDataSettings() {
  const { status, actions } = useDesk();
  const st = status.stocks ?? {};
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const saved = st.keySet ? loadTdKey() : null;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await actions.setTwelveDataKey(key);
    setBusy(false);
    if (res.ok) { setKey(''); setMsg({ ok: true, text: 'Key saved. The desk is loading stock history — the first load takes about 12 minutes on the free plan.' }); }
    else setMsg({ ok: false, text: res.error });
  }

  function remove() {
    if (!window.confirm('Remove the Twelve Data key from this browser? The desk will stop searching stocks.')) return;
    actions.clearTwelveDataKey();
    setMsg(null);
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">Stock data (Twelve Data)</div>
        {st.keySet ? <Badge tone="green">Connected</Badge> : <Badge tone="grey">No key</Badge>}
      </div>
      <p className="text-[11px] text-[#8b949e] leading-relaxed">
        Coinbase lets you trade stocks but does not provide stock charts, so the desk reads them from Twelve Data with your own free key
        (sign up at <a href="https://twelvedata.com/register" target="_blank" rel="noopener noreferrer" className="text-[#58a6ff] hover:underline">twelvedata.com</a> — the free plan allows 800 requests a day, which is enough).
        The key stays in this browser only.
      </p>

      {st.keySet ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs text-white">•••• {String(saved ?? '').slice(-4)}</span>
          <button type="button" className={BTN} onClick={remove}>Remove</button>
        </div>
      ) : (
        <form onSubmit={save} className="flex flex-col sm:flex-row gap-2">
          <input className={INPUT} type="password" autoComplete="off" spellCheck={false} placeholder="Paste your Twelve Data API key"
            value={key} onChange={(e) => setKey(e.target.value)} aria-label="Twelve Data API key" />
          <button type="submit" disabled={busy || !key.trim()} className="px-4 py-2 rounded-md text-xs font-semibold bg-[#1f6feb] hover:bg-[#388bfd] text-white disabled:opacity-40 whitespace-nowrap">
            {busy ? 'Checking…' : 'Save key'}
          </button>
        </form>
      )}
      {msg && <p className={`text-[11px] ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}

      {st.keySet && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[11px]">
          <div><dt className="text-[#484f58]">Stocks loaded</dt><dd className="font-mono text-white">{st.loaded ?? 0}/{st.total ?? 0}{st.refreshing ? ' · loading' : ''}</dd></div>
          <div><dt className="text-[#484f58]">Requests today</dt><dd className="font-mono text-white">{st.credits?.usedToday ?? 0} of {st.credits?.dayLimit ?? 800}</dd></div>
          <div><dt className="text-[#484f58]">Last update</dt><dd className="font-mono text-white">{timeAgo(st.lastRefresh)}</dd></div>
          <div><dt className="text-[#484f58]">Market</dt><dd className="text-white">{st.market?.label ?? '—'}</dd></div>
        </dl>
      )}
      {st.keySet && st.error && <p className="text-[11px] text-yellow-300">{st.error}</p>}
    </Card>
  );
}

// Live page: the switch for automatic trading with real money, its status and log.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ADMIN_EMAIL } from '../../lib/supabase';
import { loadKeys, loadProxyPref } from '../../lib/coinbaseKeys';
import { onPendingConfirmations, pendingConfirmations, respondToConfirmation } from '../../lib/notify';
import { useDesk } from '../DeskProvider';
import { loadLive, onLive, setMode } from '../live/liveStore';
import { closeLivePosition, LIVE_RULES } from '../live/liveTrader';
import NotificationSettings from './NotificationSettings';
import { Badge, Card, SectionLabel, CoinChip, BTN } from './atoms';
import { fmtUsd, fmtPrice, fmtPct, timeAgo } from './format';
import { sectorOf } from '../universe';

const MODES = [
  { id: 'off', label: 'Off' },
  { id: 'auto', label: 'Auto Trade' },
  { id: 'confirm', label: 'Auto Trade W/Confirmations' },
];

const RISK_TEXT = [
  'This places REAL orders on Coinbase with your money.',
  `Each trade risks about ${LIVE_RULES.riskPct}% of your Coinbase balance; at most ${LIVE_RULES.maxPositions} positions (${LIVE_RULES.maxPerSector} per sector); no new buys after a ${LIVE_RULES.dailyLossPct}% loss in a day.`,
  'It copies the Trading Desk\'s paper decisions, and runs only while this site is open in a browser on this computer with the local proxy running.',
  'Coinbase has no stop orders for stocks, so the bot watches stock stops itself during market hours — keep the site open on trading days.',
  'Past results do not guarantee future results. Continue?',
].join('\n\n');

export default function LiveAutoTradePanel() {
  const { user } = useAuth();
  const { summary } = useDesk();
  const [live, setLive] = useState(loadLive);
  const [pending, setPending] = useState(pendingConfirmations);
  const [clock, setClock] = useState(0);
  const isAdmin = user?.email === ADMIN_EMAIL;

  useEffect(() => onLive(setLive), []);
  useEffect(() => onPendingConfirmations(setPending), []);
  useEffect(() => {
    if (!pending.length) return undefined;
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pending.length]);

  const keys = loadKeys();
  const proxyOn = loadProxyPref();
  const ready = isAdmin && keys?.apiKey && proxyOn;

  function choose(mode) {
    if (mode === live.mode) return;
    if (mode !== 'off') {
      if (!ready) return;
      if (!window.confirm(RISK_TEXT)) return;
    }
    setMode(mode, mode === 'off' ? user?.email ?? null : user?.email ?? 'admin');
  }

  const positions = Object.values(live.positions ?? {});
  const shortRecord = (summary.trades ?? 0) < 10;

  return (
    <Card className="p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm font-semibold text-white">Automatic trading</div>
          <Badge tone={live.mode === 'off' ? 'grey' : 'red'}>{live.mode === 'off' ? 'OFF' : 'LIVE — REAL MONEY'}</Badge>
        </div>
        <p className="text-[11px] text-[#8b949e] mt-1 leading-relaxed">
          Copies the Trading Desk&apos;s decisions onto your Coinbase account: when the paper account opens a trade, this buys the same coin or stock (sized to risk {LIVE_RULES.riskPct}% of your Coinbase balance); when the paper account closes it, this sells.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <SectionLabel className="mb-1.5">Mode</SectionLabel>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Automatic trading mode">
            {MODES.map((m) => {
              const active = live.mode === m.id;
              const disabled = m.id !== 'off' && !ready;
              return (
                <button key={m.id} type="button" role="radio" aria-checked={active} disabled={disabled}
                  onClick={() => choose(m.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-40 ${
                    active ? (m.id === 'off' ? 'bg-[#21262d] text-white border-[#30363d]' : 'bg-red-500/15 text-red-300 border-red-500/40') : 'text-[#8b949e] border-[#30363d] hover:text-white'}`}>
                  {m.label}
                </button>
              );
            })}
          </div>
          {!isAdmin && <p className="text-[11px] text-yellow-300 mt-2">Sign in as Admin to turn on automatic trading. <Link to="/subscribe?mode=signin" className="underline">Sign in</Link></p>}
          {isAdmin && !keys?.apiKey && <p className="text-[11px] text-yellow-300 mt-2">Save your Coinbase API key above first.</p>}
          {isAdmin && keys?.apiKey && !proxyOn && <p className="text-[11px] text-yellow-300 mt-2">Turn on the local proxy above first.</p>}
          {live.mode === 'confirm' && <p className="text-[11px] text-[#8b949e] mt-2">Every buy waits up to 2 minutes for your Confirm (phone or this page). No answer means no trade. Sells and stops run without asking, to protect you.</p>}
        </div>
        <div className="rounded-lg border border-[#30363d] bg-[#1c2128] p-3">
          <SectionLabel className="mb-1.5">Paper record the trades are copied from</SectionLabel>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <span className="text-[#8b949e]">Closed trades</span><span className="font-mono text-white text-right">{summary.trades ?? 0}</span>
            <span className="text-[#8b949e]">Win rate</span><span className="font-mono text-white text-right">{summary.winRate != null ? `${summary.winRate.toFixed(0)}%` : '—'}</span>
            <span className="text-[#8b949e]">Profit factor</span><span className="font-mono text-white text-right">{summary.profitFactor != null ? summary.profitFactor.toFixed(2) : '—'}</span>
            <span className="text-[#8b949e]">Total return</span><span className={`font-mono text-right ${summary.totalPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtPct(summary.totalPct)}</span>
          </div>
          {shortRecord && <p className="text-[11px] text-yellow-300 mt-2">Fewer than 10 closed paper trades so far — too few to judge whether the approach works.</p>}
        </div>
      </div>

      {pending.length > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 space-y-2" role="alert">
          <SectionLabel>Waiting for your confirmation</SectionLabel>
          {pending.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[12rem]">
                <div className="text-sm text-white">{p.title}</div>
                <div className="text-[11px] text-[#8b949e]">{p.message} · {Math.max(0, Math.ceil((p.expiresAt - (clock || p.expiresAt - 120000)) / 1000))}s left</div>
              </div>
              <button type="button" className="px-3 py-1.5 rounded-md text-xs font-semibold bg-[#238636] hover:bg-[#2ea043] text-white" onClick={() => respondToConfirmation(p.id, 'confirm')}>Confirm</button>
              <button type="button" className={BTN} onClick={() => respondToConfirmation(p.id, 'reject')}>Reject</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <SectionLabel className="mb-1.5">Status</SectionLabel>
          <div className="text-[11px] text-[#8b949e] space-y-0.5">
            <div>Last check: {live.lastCycle ? `${timeAgo(live.lastCycle.time)} — ` : 'not yet'}<span className={live.lastCycle?.ok === false ? 'text-red-400' : 'text-white'}>{live.lastCycle?.text ?? ''}</span></div>
            {live.account && <div>Coinbase balance: <span className="font-mono text-white">{fmtUsd(live.account.equity)}</span> · cash <span className="font-mono text-white">{fmtUsd(live.account.cash)}</span></div>}
          </div>
        </div>
        <div>
          <SectionLabel className="mb-1.5">Live positions ({positions.length})</SectionLabel>
          {positions.length === 0 ? <p className="text-[11px] text-[#484f58]">None.</p> : (
            <ul className="space-y-2">
              {positions.map((p) => (
                <li key={p.sym} className="flex flex-wrap items-center gap-2 text-[11px]">
                  <CoinChip sym={p.sym} size="sm" />
                  <span className="text-white font-semibold">{p.sym}</span>
                  <Badge tone="grey">{sectorOf(p.sector)?.label ?? p.sector}</Badge>
                  <span className="font-mono text-[#8b949e]">{Number(Number(p.qty).toFixed(5))} @ {fmtPrice(p.entryPrice)}</span>
                  <span className="font-mono text-[#8b949e]">stop {fmtPrice(p.stop)}</span>
                  <Badge tone={p.asset === 'crypto' && p.stopOrderId ? 'green' : 'yellow'}>{p.asset === 'crypto' && p.stopOrderId ? 'stop order on Coinbase' : 'stop watched by the bot'}</Badge>
                  {p.status !== 'open' && <Badge tone="blue">{p.status}</Badge>}
                  <button type="button" className={`${BTN} ml-auto`} onClick={() => { if (window.confirm(`Sell all ${p.sym} on Coinbase now?`)) closeLivePosition(p.sym); }}>Close now</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>
        <SectionLabel className="mb-1.5">Activity</SectionLabel>
        {(live.log ?? []).length === 0 ? <p className="text-[11px] text-[#484f58]">Nothing yet.</p> : (
          <ul className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {live.log.slice(0, 20).map((l, i) => (
              <li key={`${l.time}-${i}`} className="text-[11px] flex gap-2">
                <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${l.kind === 'error' ? 'bg-red-400' : l.kind === 'buy' ? 'bg-green-400' : l.kind === 'sell' ? 'bg-blue-400' : l.kind === 'confirm' ? 'bg-yellow-400' : 'bg-[#484f58]'}`} />
                <span className="text-[#c9d1d9] flex-1 break-words">{l.text}</span>
                <span className="text-[#484f58] whitespace-nowrap">{timeAgo(l.time)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <SectionLabel className="mb-1.5">Phone alerts</SectionLabel>
        <NotificationSettings compact />
      </div>
    </Card>
  );
}

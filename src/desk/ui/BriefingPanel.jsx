// Agent 1 · Briefing — the market's mood, the regime, the balance and the
// headlines, ending in the instruction handed to the Scout.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDesk } from '../DeskProvider';
import { Badge, Card, SectionLabel } from './atoms';
import { fmtUsd, fmtPrice, fmtPct, timeAgo } from './format';

const PHASES = {
  bull: { label: 'Uptrend', tone: 'green', text: 'Bitcoin is above its long-term average. Long breakouts are allowed.' },
  correction: { label: 'Correction', tone: 'yellow', text: 'Bitcoin is below a long-term average that is still rising. The desk stands aside.' },
  bear: { label: 'Downtrend', tone: 'red', text: 'Bitcoin is below a falling long-term average. Buying is blocked.' },
  unknown: { label: 'Unknown', tone: 'grey', text: 'Not enough Bitcoin history to judge the regime. The desk stands aside.' },
};
const STANCE_TONE = { 'Risk-on': 'green', 'Risk-off': 'red', Mixed: 'grey' };
const signed = (v) => `${v > 0 ? '+' : ''}${v}`;
const pctTone = (v) => (v == null ? 'text-[#8b949e]' : v >= 0 ? 'text-green-400' : 'text-red-400');
const Inset = ({ children, className = '' }) => <div className={`rounded-lg border border-[#30363d] bg-[#1c2128] p-3 ${className}`}>{children}</div>;

// Score runs -100..100; the stance flips at -25 and +25, so the zones are 37.5 / 25 / 37.5 % wide.
function MoodMeter({ score, stance }) {
  const pos = Math.max(0, Math.min(100, (score + 100) / 2));
  return (
    <Inset>
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <SectionLabel>Market mood</SectionLabel>
        <div className="text-sm"><span className="font-semibold text-white">{stance}</span> <span className="font-mono text-[#8b949e]">{signed(score)}</span></div>
      </div>
      <div className="relative" role="img" aria-label={`Market mood ${signed(score)} on a scale from -100 to +100: ${stance}`}>
        <div className="flex gap-0.5 h-2">
          <div className="rounded-l-full bg-[#f85149]/50" style={{ width: '37.5%' }} />
          <div className="bg-[#484f58]/60" style={{ width: '25%' }} />
          <div className="rounded-r-full bg-[#3fb950]/50" style={{ width: '37.5%' }} />
        </div>
        <div className="absolute -top-1 w-1.5 h-4 rounded-full bg-white ring-2 ring-[#1c2128] -translate-x-1/2" style={{ left: `${pos}%` }} />
      </div>
      <div className="flex text-[10px] text-[#8b949e] mt-1.5">
        <span style={{ width: '37.5%' }}>Risk-off</span>
        <span className="text-center" style={{ width: '25%' }}>Mixed</span>
        <span className="text-right" style={{ width: '37.5%' }}>Risk-on</span>
      </div>
    </Inset>
  );
}

function Balance({ balance }) {
  const cb = balance?.coinbase;
  let line;
  if (!cb?.connected) {
    line = <>Coinbase is not connected in this browser — add your API key on the <Link to="/live" className="text-[#58a6ff] hover:underline">Live page</Link> to show your real balance here.</>;
  } else if (cb.ok) {
    line = <>Coinbase cash: <span className="font-mono text-white">{fmtUsd(cb.cash)}</span> · {cb.assets} other asset{cb.assets === 1 ? '' : 's'}</>;
  } else {
    line = <span className="text-yellow-400">Coinbase balance unavailable: {cb.error}</span>;
  }
  return (
    <Inset>
      <SectionLabel className="mb-2">Balance</SectionLabel>
      <div className="flex flex-wrap gap-x-6 gap-y-1 mb-2">
        <div><div className="text-[10px] text-[#8b949e]">Paper equity</div><div className="font-mono font-bold text-white">{fmtUsd(balance?.paper?.equity)}</div></div>
        <div><div className="text-[10px] text-[#8b949e]">Paper cash</div><div className="font-mono font-bold text-white">{fmtUsd(balance?.paper?.cash)}</div></div>
      </div>
      <p className="text-[11px] text-[#8b949e] leading-relaxed break-words">{line}</p>
    </Inset>
  );
}

function FearGreed({ fg }) {
  const v = Math.max(0, Math.min(100, Number(fg.value) || 0));
  return (
    <Inset>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <SectionLabel>Fear &amp; Greed</SectionLabel>
        <div className="text-sm"><span className="font-mono font-bold text-white">{fg.value}</span> <span className="text-[#8b949e]">{fg.label}</span></div>
      </div>
      <div className="h-1.5 rounded-full bg-[#30363d]" role="img" aria-label={`Fear and Greed index ${fg.value} out of 100: ${fg.label}`}>
        <div className="h-full rounded-full bg-[#58a6ff]" style={{ width: `${v}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-[#484f58] mt-1"><span>0 fear</span><span>100 greed</span></div>
    </Inset>
  );
}

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

function Headlines({ news, external }) {
  const [all, setAll] = useState(false);
  const list = news?.headlines ?? [];
  const shown = all ? list : list.slice(0, 8);
  const sources = external?.sources ?? [];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2">
        <SectionLabel>Headlines</SectionLabel>
        <span className="text-[11px] text-[#8b949e]">News last read {timeAgo(external?.fetchedAt)}</span>
        <div className="flex flex-wrap gap-1.5">
          {sources.map((s) => (
            <Badge key={s.name} tone={s.ok ? 'grey' : 'red'} title={s.ok ? `${s.count ?? 0} headlines` : 'This source did not answer'}>
              {s.name} · {s.ok ? 'ok' : 'failed'}
            </Badge>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <p className="text-xs text-[#8b949e]">No headlines could be loaded this hour — the desk falls back to price-based regime only.</p>
      ) : (
        <>
          <ul className="divide-y divide-[#21262d]">
            {shown.map((h, i) => (
              <li key={`${h.url ?? h.title}-${i}`} className="py-2 flex items-start gap-2.5">
                <span className="w-16 flex-shrink-0 pt-0.5">
                  <Badge tone={h.score > 0 ? 'green' : h.score < 0 ? 'red' : 'grey'}>{h.score > 0 ? 'positive' : h.score < 0 ? 'negative' : 'neutral'}</Badge>
                </span>
                <div className="min-w-0 flex-1">
                  {isHttp(h.url) ? (
                    <a href={h.url} target="_blank" rel="noopener noreferrer" className="text-sm text-white hover:text-[#58a6ff] break-words">{h.title}</a>
                  ) : (
                    <span className="text-sm text-white break-words">{h.title}</span>
                  )}
                  <div className="text-[11px] text-[#8b949e] mt-0.5 break-words">
                    {h.source}{h.time ? ` · ${timeAgo(h.time)}` : ''}
                    {h.hits?.length > 0 && <span className="font-mono text-[#484f58]"> · matched {h.hits.join(' ')}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {list.length > 8 && (
            <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 text-xs text-[#58a6ff] hover:underline">
              {all ? 'Show fewer' : `Show all ${list.length}`}
            </button>
          )}
        </>
      )}
      <p className="text-[11px] text-[#484f58] mt-2 leading-relaxed">
        The tone score is a simple keyword count, shown so you can see what moved it; it can only veto trades, never trigger them.
      </p>
    </div>
  );
}

export default function BriefingPanel() {
  const { state } = useDesk();
  const brief = state.last?.brief ?? null;

  if (!brief) {
    return (
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-white">Agent 1 · Briefing</h2>
        <p className="text-xs text-[#8b949e] mt-2">The first briefing is still being put together. It reads the headlines, the Fear &amp; Greed index and the balance, then judges the Bitcoin trend.</p>
      </Card>
    );
  }

  const r = brief.regime ?? {};
  const phase = PHASES[r.phase] ?? PHASES.unknown;
  const news = brief.news;

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-white">Agent 1 · Briefing</h2>
        <Badge tone={STANCE_TONE[brief.stance] ?? 'grey'}>{brief.stance}</Badge>
        <Badge tone={phase.tone}>{phase.label}</Badge>
        <span className="text-[11px] text-[#484f58] ml-auto">Reads the market before anyone looks for a trade</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-3 min-w-0">
          <MoodMeter score={brief.score ?? 0} stance={brief.stance} />
          <Inset>
            <SectionLabel className="mb-2">What moved the mood</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {(brief.parts ?? []).map((p) => (
                <span key={p.name} className="px-2 py-1 rounded-md bg-[#161b22] border border-[#30363d] text-[11px] text-[#8b949e]">
                  {p.name} <span className={`font-mono font-semibold ${p.value > 0 ? 'text-green-400' : p.value < 0 ? 'text-red-400' : 'text-[#8b949e]'}`}>{signed(p.value)}</span>
                </span>
              ))}
            </div>
            <p className="text-[10px] text-[#484f58] mt-2">These add up to the mood score of <span className="font-mono">{signed(brief.score ?? 0)}</span>.</p>
          </Inset>
          <Inset>
            <SectionLabel className="mb-2">Market regime</SectionLabel>
            <p className="text-sm text-white">{phase.label}</p>
            <p className="text-xs text-[#8b949e] mt-0.5 leading-relaxed">{phase.text}</p>
            {r.close != null && (
              <dl className="grid grid-cols-3 gap-2 mt-3">
                <div><dt className="text-[10px] text-[#8b949e]">Bitcoin</dt><dd className="font-mono text-sm text-white">{fmtPrice(r.close)}</dd></div>
                <div><dt className="text-[10px] text-[#8b949e]">7 days</dt><dd className={`font-mono text-sm ${pctTone(r.ret7)}`}>{fmtPct(r.ret7)}</dd></div>
                <div><dt className="text-[10px] text-[#8b949e]">30 days</dt><dd className={`font-mono text-sm ${pctTone(r.ret30)}`}>{fmtPct(r.ret30)}</dd></div>
              </dl>
            )}
            {r.distAnchorPct != null && (
              <p className="text-[11px] text-[#8b949e] mt-2">
                <span className={`font-mono ${pctTone(r.distAnchorPct)}`}>{Math.abs(r.distAnchorPct).toFixed(1)}%</span>{' '}
                {r.distAnchorPct >= 0 ? 'above' : 'below'} its {r.anchorLabel ?? '200-day average'}
                {r.sma200 != null && <> (<span className="font-mono">{fmtPrice(r.sma200)}</span>)</>}
              </p>
            )}
          </Inset>
        </div>

        <div className="space-y-3 min-w-0">
          <Inset>
            <SectionLabel className="mb-2">What it found</SectionLabel>
            {(brief.notes ?? []).length === 0 ? <p className="text-xs text-[#8b949e]">Nothing notable this hour.</p> : (
              <ul className="space-y-1.5">
                {brief.notes.map((n) => (
                  <li key={n} className="flex gap-2 text-xs text-[#8b949e] leading-relaxed">
                    <span className="w-1 h-1 rounded-full bg-[#484f58] flex-shrink-0 mt-[7px]" aria-hidden="true" /><span>{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </Inset>
          <div className="rounded-lg border border-[#58a6ff]/30 bg-[#58a6ff]/10 p-3">
            <SectionLabel className="mb-1 !text-[#58a6ff]">Hand-off to the Scout</SectionLabel>
            <p className="text-sm font-semibold text-white">{brief.directive}</p>
          </div>
          <Balance balance={brief.balance} />
          {brief.fearGreed && <FearGreed fg={brief.fearGreed} />}
        </div>
      </div>

      <div className="border-t border-[#30363d] pt-4">
        <Headlines news={news} external={state.external} />
      </div>
    </Card>
  );
}

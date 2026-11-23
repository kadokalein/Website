// The Trading Desk: what each of the three agents concluded and why, top to
// bottom, in the order the work flows.
import { useMemo } from 'react';
import AppNav from '../components/AppNav';
import { useDesk } from '../desk/DeskProvider';
import { Badge, Card, SectionLabel, BTN } from '../desk/ui/atoms';
import { timeAgo } from '../desk/ui/format';
import PipelineStrip from '../desk/ui/PipelineStrip';
import BriefingPanel from '../desk/ui/BriefingPanel';
import ScoutBoard from '../desk/ui/ScoutBoard';
import AnalystReports from '../desk/ui/AnalystReports';
import DeskGuide from '../desk/ui/DeskGuide';

const SECTIONS = { briefing: 'desk-briefing', scout: 'desk-scout', analyst: 'desk-analyst' };
const LOG_DOT = { win: 'bg-[#3fb950]', loss: 'bg-[#f85149]', open: 'bg-[#58a6ff]', watch: 'bg-yellow-400', brief: 'bg-[#484f58]' };
const LOG_LABEL = { win: 'Winning trade', loss: 'Losing trade', open: 'Trade opened', watch: 'Saved for later', brief: 'Briefing' };

// The desk's bottom line in plain language, from the last completed run.
function todaysCall(last, savedCount, holding) {
  if (!last) return null;
  const brief = last.brief ?? {};
  const analyses = last.analyses ?? [];
  const approved = analyses.filter((a) => a.decision === 'BUY' || a.decision === 'SHORT');
  if (approved.length > 0) return { approved };
  const open = (last.scouts ?? []).filter((s) => s.verdict === 'OPEN' && !s.held);
  if (open.length > 0 && analyses.length > 0) return { text: 'Candidates were found but none passed the Analyst.' };
  const phase = brief.regime?.phase;
  if (phase === 'bear' || phase === 'correction' || !brief.allowLong) {
    // In an uptrend the first note says longs are allowed; the veto that overrode it comes later.
    const notes = brief.notes ?? [];
    const why = (phase === 'bull' ? notes.find((n) => /holding off/i.test(n)) : notes[0]) ?? 'The Briefing is not allowing new trades right now.';
    const plan = holding ? 'Opening nothing new' : 'Staying in cash';
    return { text: `No trade today. ${why} ${plan} is the plan working, not the bot being idle.` };
  }
  const saved = savedCount === 0 ? 'No coins are saved for later either.'
    : savedCount === 1 ? '1 coin is saved for later.' : `${savedCount} coins are saved for later.`;
  return { text: `No trade today — nothing has closed through its line. ${saved}` };
}

function CallBanner({ call, time, auto }) {
  if (!call) {
    return (
      <Card className="p-4 sm:p-5">
        <SectionLabel className="mb-2">Today&apos;s call</SectionLabel>
        <p className="text-base text-[#8b949e] flex items-center gap-2.5">
          <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-orange-400/30 border-t-orange-400 animate-spin flex-shrink-0" aria-hidden="true" />
          The desk is running its first pass…
        </p>
      </Card>
    );
  }
  return (
    <Card className={`p-4 sm:p-5 ${call.approved ? 'border-green-500/40' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <SectionLabel>Today&apos;s call</SectionLabel>
        <span className="text-[11px] text-[#484f58]">as of {timeAgo(time)}</span>
        {!auto && <Badge tone="yellow" title="The desk keeps analysing and managing exits but opens no new trades">Auto paused</Badge>}
      </div>
      {call.approved ? (
        <ul className="space-y-3">
          {call.approved.map((a) => (
            <li key={a.sym}>
              <p className="text-base sm:text-lg text-white leading-snug">
                <span className="inline-block align-middle mr-2"><Badge tone={a.decision === 'SHORT' ? 'red' : 'green'}>{a.decision}</Badge></span>
                Trade approved: {a.summary}
              </p>
              {a.note && <p className="text-sm text-[#8b949e] mt-1">{a.note}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-base sm:text-lg text-white leading-snug">{call.text}</p>
      )}
      <p className="text-[11px] text-[#484f58] mt-3">Paper trades only, in a simulated $5,000 account that charges real Coinbase fees and slippage.</p>
    </Card>
  );
}

function Activity({ log }) {
  const rows = log.slice(0, 30);
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-white">Activity</h2>
      <p className="text-xs text-[#8b949e] mt-0.5 mb-3">What the desk has done, newest first.</p>
      {rows.length === 0 ? (
        <p className="text-xs text-[#8b949e]">Nothing has happened yet.</p>
      ) : (
        <ul className="divide-y divide-[#21262d]">
          {rows.map((e, i) => (
            <li key={`${e.time}-${i}`} className="py-2 flex items-start gap-2.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${LOG_DOT[e.kind] ?? LOG_DOT.brief}`} title={LOG_LABEL[e.kind] ?? 'Note'} />
              <span className="sr-only">{LOG_LABEL[e.kind] ?? 'Note'}:</span>
              <span className="text-xs text-[#8b949e] leading-relaxed flex-1 min-w-0 break-words">{e.text}</span>
              <span className="text-[10px] text-[#484f58] font-mono whitespace-nowrap pt-0.5">{timeAgo(e.time)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function TradingDesk() {
  const { state, status, actions } = useDesk();
  const auto = !!state.settings?.auto;
  const savedCount = useMemo(() => Object.keys(state.watch ?? {}).length, [state.watch]);
  const holding = useMemo(() => Object.keys(state.account?.positions ?? {}).length > 0, [state.account]);
  const call = useMemo(() => todaysCall(state.last, savedCount, holding), [state.last, savedCount, holding]);

  const navActions = (
    <>
      <button type="button" className={BTN} onClick={() => actions.runNow()} disabled={status.running}>
        {status.running ? 'Running…' : 'Run now'}
      </button>
      <button type="button" onClick={() => actions.setAuto(!auto)} aria-pressed={auto}
        title={auto ? 'Approved trades are opened in the paper account. Click to pause.' : 'The desk keeps analysing and managing exits but opens no new trades. Click to resume.'}
        className={`px-3 py-1.5 rounded-md text-xs border whitespace-nowrap transition-colors ${
          auto ? 'bg-green-500/15 border-green-500/30 text-green-300 hover:bg-green-500/25' : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:text-white'}`}>
        {auto ? 'Auto: on' : 'Auto: paused'}
      </button>
    </>
  );

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <AppNav badge={{ text: 'PAPER', tone: 'blue' }} actions={navActions} />
      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-white">Trading Desk</h1>
          <p className="text-xs text-[#8b949e] mt-0.5">Three agents work in order: one reads the market, one looks for a line being broken, one decides. A day with no trade is a normal result.</p>
        </div>

        <PipelineStrip targets={SECTIONS} />
        <CallBanner call={call} time={state.last?.time} auto={auto} />

        <section id={SECTIONS.briefing} className="scroll-mt-36 lg:scroll-mt-20"><BriefingPanel /></section>
        <section id={SECTIONS.scout} className="scroll-mt-36 lg:scroll-mt-20"><ScoutBoard /></section>
        <section id={SECTIONS.analyst} className="scroll-mt-36 lg:scroll-mt-20"><AnalystReports /></section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <Activity log={state.log ?? []} />
          <DeskGuide />
        </div>
      </main>
    </div>
  );
}

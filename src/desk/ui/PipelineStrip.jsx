// The desk at a glance: Briefing → Scout → Analyst → Paper account, with the
// one-line result of each step and a live status line underneath.
import { Fragment, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDesk } from '../DeskProvider';
import { BTN } from './atoms';
import { fmtUsd, fmtPct, timeAgo } from './format';

function Spinner() {
  return <span className="inline-block w-3 h-3 rounded-full border-2 border-orange-400/30 border-t-orange-400 animate-spin flex-shrink-0" aria-hidden="true" />;
}

function Connector() {
  return (
    <div className="flex items-center justify-center h-3 md:h-auto md:w-6 text-[#484f58] flex-shrink-0" aria-hidden="true">
      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 rotate-90 md:rotate-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 8h11M9 4l4 4-4 4" />
      </svg>
    </div>
  );
}

const SHELL = 'block w-full h-full text-left rounded-xl border bg-[#161b22] p-3 transition-colors hover:border-[#484f58] focus:outline-none focus-visible:border-[#58a6ff]';

function StepBody({ num, title, active, children }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-1.5">
        {num != null && (
          <span className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold font-mono flex-shrink-0 ${
            active ? 'bg-orange-500/20 text-orange-300' : 'bg-[#21262d] text-[#8b949e]'}`}>{num}</span>
        )}
        <span className="text-sm font-semibold text-white">{title}</span>
        {active && <span className="ml-auto flex items-center gap-1.5 text-[10px] text-orange-300">working <Spinner /></span>}
      </div>
      <div className="text-xs text-[#8b949e] leading-snug">{children}</div>
    </>
  );
}

function jumpTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// `targets` maps each agent step to the id of its section on the page.
export default function PipelineStrip({ targets = {} }) {
  const { state, status, health, summary, actions } = useDesk();
  const last = state.last;

  const view = useMemo(() => {
    const brief = last?.brief ?? null;
    const scouts = last?.scouts ?? [];
    const analyses = last?.analyses ?? [];
    const phase = brief?.regime?.phase;
    let permission = 'standing aside';
    if (brief?.allowLong) permission = 'longs allowed';
    else if (brief?.allowShort) permission = 'shorts allowed';
    else if (phase === 'bear') permission = 'buying blocked';
    return {
      brief,
      permission,
      open: scouts.filter((s) => s.verdict === 'OPEN').length,
      passed: scouts.filter((s) => s.verdict === 'PASS').length,
      saved: Object.keys(state.watch ?? {}).length,
      approved: analyses.filter((a) => a.decision !== 'REJECT').length,
      rejected: analyses.filter((a) => a.decision === 'REJECT').length,
      positions: Object.keys(state.account?.positions ?? {}).length,
    };
  }, [last, state.watch, state.account]);

  const waiting = <span className="text-[#484f58]">Waiting for the first run</span>;
  const steps = [
    {
      key: 'briefing', num: 1, title: 'Briefing',
      body: view.brief ? <><span className="text-white">{view.brief.stance}</span> · {view.permission}</> : waiting,
    },
    {
      key: 'scout', num: 2, title: 'Scout',
      body: last ? (
        <><span className="font-mono text-white">{view.open}</span> open · <span className="font-mono text-white">{view.saved}</span> saved for later · <span className="font-mono text-white">{view.passed}</span> passed</>
      ) : waiting,
    },
    {
      key: 'analyst', num: 3, title: 'Analyst',
      body: !last ? waiting : view.approved + view.rejected === 0 ? 'No candidates today' : (
        <><span className="font-mono text-white">{view.approved}</span> approved · <span className="font-mono text-white">{view.rejected}</span> rejected</>
      ),
    },
  ];

  const lastRun = status.lastRun ?? last?.time ?? null;
  const border = (active) => (active ? 'border-orange-400/70' : 'border-[#30363d]');

  return (
    <section aria-label="Desk pipeline" className="space-y-2">
      <div className="flex flex-col md:flex-row md:items-stretch gap-1 md:gap-0">
        {steps.map((s, i) => {
          const active = status.running && status.phase === s.key;
          return (
            <Fragment key={s.key}>
              {i > 0 && <Connector />}
              <div className="flex-1 min-w-0">
                <button type="button" onClick={() => jumpTo(targets[s.key])} className={`${SHELL} ${border(active)}`}
                  aria-current={active ? 'step' : undefined} title={`Jump to the ${s.title} section`}>
                  <StepBody num={s.num} title={s.title} active={active}>{s.body}</StepBody>
                </button>
              </div>
            </Fragment>
          );
        })}
        <Connector />
        <div className="flex-1 min-w-0">
          <Link to="/paper" className={`${SHELL} ${border(false)}`} title="Open the Portfolio page">
            <StepBody title="Paper account">
              <span className="font-mono text-white">{fmtUsd(summary.equity)}</span>{' '}
              <span className={`font-mono ${summary.totalPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtPct(summary.totalPct)}</span>
              {' · '}{view.positions} open position{view.positions === 1 ? '' : 's'}
            </StepBody>
          </Link>
        </div>
      </div>

      <p className="text-[11px] text-[#484f58] px-1" role="status" aria-live="polite">
        {status.running ? (
          <span className="text-[#8b949e]">
            {status.detail || 'Working'}
            {status.progress && <span className="font-mono"> {status.progress.done}/{status.progress.total}</span>}
          </span>
        ) : status.leader === false ? (
          <>Another tab of this site is running the desk — this tab shows its results · last run {timeAgo(lastRun)}</>
        ) : (
          <>Last run {timeAgo(lastRun)} · checks again every 5 minutes · news refreshes hourly</>
        )}
      </p>

      {!status.error && status.notice && (
        <div className="rounded-lg border border-yellow-500/25 bg-yellow-500/10 px-3 py-2" role="status">
          <p className="text-xs text-yellow-300 break-words">{status.notice}</p>
        </div>
      )}

      {status.error && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2" role="alert">
          <p className="flex-1 min-w-[12rem] text-xs text-red-400 break-words">
            The last run did not finish: {status.error}
            {health.pausedUntil > (health.lastError?.at ?? Infinity) && <> Requests to Coinbase are paused for a short while and resume automatically.</>}
          </p>
          <button type="button" className={BTN} onClick={() => actions.runNow()} disabled={status.running}>Retry</button>
        </div>
      )}
    </section>
  );
}

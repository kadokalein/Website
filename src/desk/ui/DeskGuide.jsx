// "How the desk decides" — the three agents, the hard rules, and an honest
// summary of how the strategy tested.
import { Link } from 'react-router-dom';
import { Card, SectionLabel } from './atoms';

const AGENTS = [
  ['Briefing', 'Every hour it reads crypto headlines, the Fear & Greed index and the account balance, and checks Bitcoin against its 200-day average. It tells the Scout which direction, if any, is allowed.'],
  ['Scout', 'Takes a quick look at 28 liquid coins with the lines drawn: the 20-day range, support and resistance zones, and trendlines. A daily close through the range line is an open opportunity. Close but not there yet is saved for later, for up to 7 days.'],
  ['Analyst', 'Works up each open candidate in full. A few must-pass checks decide, and a longer checklist supports the call. It answers buy, short or reject, with an entry, a stop and an exit rule.'],
];

const RULES = [
  'At most 1% of the account is at risk on any one trade.',
  'At most 3 positions at once and 2 new trades a day.',
  'It stops opening trades for the day after a 2% loss.',
  'It only trades in the direction Bitcoin\'s long-term trend allows.',
  'Every trade must be big enough that Coinbase\'s roughly 1.8% round-trip fees are a small part of the risk.',
];

const HEADLINE_FIGURES = [
  ['Total result', '+29.7%', 'text-green-400'],
  ['Worst drop', '-14.7%', 'text-red-400'],
  ['Trades', '51', 'text-white'],
  ['Winners', '39%', 'text-white'],
];

const BY_YEAR = [
  ['Late 2023', '+25.2%'],
  ['2024', '+5.3%'],
  ['2025', '-4.9%'],
  ['2026', '+3.5%'],
];

const CAVEATS = [
  'Most of the gain came from a handful of big trends in 2023-24.',
  '2025 was a losing year.',
  'The desk sat in cash for more than half of all days.',
  'A backtest is not a promise. It describes the past, not what happens next.',
];

export default function DeskGuide() {
  return (
    <Card className="p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">How the desk decides</h2>
        <p className="text-xs text-[#8b949e] mt-0.5">Three agents, each handing its conclusion to the next. Trades are rare, typically a few a month.</p>
      </div>

      <ol className="space-y-2.5">
        {AGENTS.map(([name, text], i) => (
          <li key={name} className="flex gap-2.5">
            <span className="w-5 h-5 rounded-full bg-[#21262d] text-[#8b949e] inline-flex items-center justify-center text-[10px] font-bold font-mono flex-shrink-0 mt-0.5">{i + 1}</span>
            <p className="text-xs text-[#8b949e] leading-relaxed"><span className="text-white font-semibold">{name}.</span> {text}</p>
          </li>
        ))}
      </ol>

      <div>
        <SectionLabel className="mb-2">The rules it will not break</SectionLabel>
        <ul className="space-y-1.5">
          {RULES.map((r) => (
            <li key={r} className="flex gap-2 text-xs text-[#8b949e] leading-relaxed">
              <span className="w-1 h-1 rounded-full bg-[#484f58] flex-shrink-0 mt-[7px]" aria-hidden="true" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-[#30363d] bg-[#1c2128] p-3 space-y-3">
        <div>
          <SectionLabel className="mb-1">Track record (backtest)</SectionLabel>
          <p className="text-xs text-[#8b949e] leading-relaxed">
            Tested on daily Coinbase candles for 9 major coins from Sep 2023 to Nov 2026, with fees and slippage included.
          </p>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {HEADLINE_FIGURES.map(([label, value, tone]) => (
            <div key={label} className="rounded-md bg-[#161b22] border border-[#30363d] px-2 py-1.5">
              <dt className="text-[10px] text-[#484f58] uppercase tracking-wider">{label}</dt>
              <dd className={`text-sm font-mono font-bold ${tone}`}>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11px] text-[#8b949e] leading-relaxed">
          Worst drop is the largest peak-to-trough fall along the way. Winners were about twice the size of losers, which is why 39% winners was enough.
        </p>

        <div>
          <div className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1">By year</div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1">
            {BY_YEAR.map(([year, value]) => (
              <div key={year} className="flex items-baseline justify-between gap-2 text-xs">
                <dt className="text-[#8b949e]">{year}</dt>
                <dd className={`font-mono ${value.startsWith('-') ? 'text-red-400' : 'text-green-400'}`}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <ul className="space-y-1 border-t border-[#30363d] pt-2.5">
          {CAVEATS.map((c) => (
            <li key={c} className="flex gap-2 text-[11px] text-[#8b949e] leading-relaxed">
              <span className="w-1 h-1 rounded-full bg-[#484f58] flex-shrink-0 mt-[7px]" aria-hidden="true" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-[#8b949e] leading-relaxed">
          The paper account on the <Link to="/paper" className="text-[#58a6ff] hover:underline">Portfolio page</Link> is the real test before any live money.
        </p>
      </div>
    </Card>
  );
}

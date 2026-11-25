// "How the desk decides" — the three agents, the hard rules, and an honest
// summary of how the strategy tested.
import { Link } from 'react-router-dom';
import { Card, SectionLabel } from './atoms';

const AGENTS = [
  ['Briefing', 'Every hour it reads the news, the Fear & Greed index and the balance. For crypto it checks Bitcoin against its 200-day average; for each stock sector it checks the S&P 500 and the sector\'s own ETF. It tells the Scout where buying is allowed.'],
  ['Scout', 'Takes a quick look at every chart with the lines drawn — 28 coins and about 70 stocks across pharma & biotech, AI, science, oil & gas, utilities and tech. A daily close through the breakout line is an open opportunity; close but not there yet is saved for later, for up to 7 days.'],
  ['Analyst', 'Works up each open candidate in full. A few must-pass checks decide, and a longer checklist supports the call. Approved trades from every sector are ranked together, strongest first.'],
];

const STOCK_RULES = [
  'The S&P 500 must be above a rising 200-day average, and the sector ETF must be trending up and beating the S&P 500.',
  'Only leaders: above their 50/150/200-day averages, within 15% of the 52-week high, and in the top 30% for relative strength.',
  'Buy the close at a new 52-week high or above a 10-week base, at most 5% (and 1 daily range) above the line.',
  'Stop 2 daily ranges below entry, never more than 8%; it moves to breakeven once the trade is up by its risk, then trails.',
  'No commission on Coinbase stocks. Pharma positions are half size because FDA news can gap them.',
];

const RULES = [
  'At most 1% of the account is at risk on any one trade.',
  'At most 3 positions at once, at most 2 in one sector, and 2 new trades a day.',
  'It stops opening trades for the day after a 2% loss.',
  'It only buys where the Briefing allows it — no forcing trades on quiet days.',
  'Crypto trades must be big enough that Coinbase\'s roughly 1.8% round-trip fees are a small part of the risk.',
];

const HEADLINE_FIGURES = [
  ['Total result', '+26.4%', 'text-green-400'],
  ['Worst drop', '-11.7%', 'text-red-400'],
  ['Trades', '34', 'text-white'],
  ['Winners', '44%', 'text-white'],
];

const BY_YEAR = [
  ['Late 2023', '+22.7%'],
  ['2024', '+3.5%'],
  ['2025', '-3.5%'],
  ['2026', '+3.2%'],
];

const CAVEATS = [
  'Most of the gain came from a handful of big trends in 2023-24.',
  '2025 was a losing year.',
  'The desk sat in cash on most days.',
  'Stock rules have not been backtested yet — they run on the paper account first.',
  'A backtest is not a promise. It describes the past, not what happens next.',
];

export default function DeskGuide() {
  return (
    <Card className="p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">How the desk decides</h2>
        <p className="text-xs text-[#8b949e] mt-0.5">Three agents, each handing its conclusion to the next, across crypto and six stock sectors. Trades are rare — a few a month — and most days the right call is no trade.</p>
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

      <div>
        <SectionLabel className="mb-2">How stocks are handled differently</SectionLabel>
        <ul className="space-y-1.5">
          {STOCK_RULES.map((r) => (
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
            Crypto rules, tested on daily Coinbase candles for 9 major coins from Sep 2023 to Nov 2026, with fees and slippage included.
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
          Worst drop is the largest peak-to-trough fall along the way. Winners were about 2.6 times the size of losers, which is why 44% winners was enough.
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

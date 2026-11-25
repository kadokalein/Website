// What the Trading Desk watches: crypto, plus stock sectors. Each stock sector is
// judged against the S&P 500 (SPY) and its own sector ETF, and has its own news
// keywords so its Briefing reads the headlines that matter to it.
//
// Every symbol here trades on Coinbase (crypto as SYM-USD, stocks/ETFs as EQUITY SYM-USD).

import { DESK_SYMBOLS } from '../constants';

export const MARKET_BENCHMARK = 'SPY';
// Extra gauges: Nasdaq-100 for AI/tech, the USO oil fund for oil & gas.
export const EXTRA_GAUGES = ['QQQ', 'USO'];

export const SECTORS = [
  {
    id: 'crypto', label: 'Crypto', kind: 'crypto', benchmark: 'BTC',
    symbols: DESK_SYMBOLS,
  },
  {
    id: 'pharma', label: 'Pharma & Biotech', kind: 'stock', benchmark: 'XLV', riskMult: 0.5, // FDA decisions can gap these stocks — half-size positions
    symbols: ['LLY', 'NVO', 'JNJ', 'MRK', 'ABBV', 'PFE', 'AMGN', 'GILD', 'VRTX', 'REGN', 'BMY', 'AZN', 'MRNA', 'BIIB', 'ALNY'],
    keywords: ['pharma', 'biotech', 'drug', 'fda', 'trial', 'vaccine', 'obesity', 'glp-1', 'oncology', 'therapy', 'eli lilly', 'pfizer', 'merck', 'novo nordisk', 'moderna', 'amgen', 'gilead', 'vertex', 'regeneron', 'abbvie', 'astrazeneca', 'johnson & johnson'],
  },
  {
    id: 'ai', label: 'AI', kind: 'stock', benchmark: 'SMH', gauge: 'QQQ',
    symbols: ['NVDA', 'MSFT', 'GOOGL', 'META', 'AMD', 'AVGO', 'PLTR', 'TSM', 'ARM', 'SMCI', 'SNOW', 'AI'],
    keywords: ['ai ', 'artificial intelligence', 'nvidia', 'chip', 'semiconductor', 'gpu', 'data center', 'openai', 'llm', 'microsoft', 'alphabet', 'google', 'meta', 'amd', 'broadcom', 'palantir', 'tsmc'],
  },
  {
    id: 'science', label: 'Science & Research', kind: 'stock', benchmark: 'XLV',
    symbols: ['TMO', 'DHR', 'A', 'ILMN', 'ISRG', 'IONQ', 'RGTI', 'QBTS', 'RKLB', 'ASTS'],
    keywords: ['quantum', 'genomic', 'laboratory', 'life science', 'research', 'space', 'satellite', 'rocket', 'robotic surgery', 'thermo fisher', 'danaher', 'illumina', 'intuitive surgical', 'ionq', 'rocket lab'],
  },
  {
    id: 'energy', label: 'Oil & Gas', kind: 'stock', benchmark: 'XLE', gauge: 'USO',
    // Not CVX: on Coinbase "CVX-USD" is a crypto token (Convex Finance), not Chevron. CTRA is not offered.
    symbols: ['XOM', 'COP', 'EOG', 'OXY', 'SLB', 'EQT', 'LNG', 'KMI', 'WMB', 'DVN'],
    keywords: ['oil', 'crude', 'natural gas', 'lng', 'opec', 'brent', 'wti', 'pipeline', 'drilling', 'refin', 'exxon', 'chevron', 'conocophillips', 'shale'],
  },
  {
    id: 'power', label: 'Electric & Utilities', kind: 'stock', benchmark: 'XLU',
    symbols: ['NEE', 'DUK', 'SO', 'CEG', 'VST', 'AEP', 'EXC', 'D', 'NRG', 'GEV'],
    keywords: ['utility', 'utilities', 'electric', 'power grid', 'nuclear', 'renewable', 'solar', 'wind power', 'electricity', 'nextera', 'duke energy', 'constellation', 'vistra', 'ge vernova'],
  },
  {
    id: 'tech', label: 'Tech', kind: 'stock', benchmark: 'XLK', gauge: 'QQQ',
    symbols: ['AAPL', 'AMZN', 'ORCL', 'CRM', 'ADBE', 'NFLX', 'SHOP', 'NOW', 'INTU', 'QCOM', 'CSCO', 'TSLA'],
    keywords: ['tech', 'software', 'cloud', 'apple', 'amazon', 'oracle', 'salesforce', 'adobe', 'netflix', 'shopify', 'servicenow', 'qualcomm', 'cisco', 'tesla', 'iphone'],
  },
];

export const STOCK_SECTORS = SECTORS.filter((s) => s.kind === 'stock');

// Every stock/ETF symbol the desk needs prices for (stocks + sector ETFs + SPY).
export function stockSymbols(enabled = null) {
  const set = new Set([MARKET_BENCHMARK, ...EXTRA_GAUGES]);
  for (const s of STOCK_SECTORS) {
    if (enabled && enabled[s.id] === false) continue;
    set.add(s.benchmark);
    for (const sym of s.symbols) set.add(sym);
  }
  return [...set];
}

export const sectorOf = (id) => SECTORS.find((s) => s.id === id) ?? null;

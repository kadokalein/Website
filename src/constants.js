export const COINS = [
  { symbol: 'BTC',  name: 'Bitcoin',  color: '#F7931A' },
  { symbol: 'ETH',  name: 'Ethereum', color: '#627EEA' },
  { symbol: 'SOL',  name: 'Solana',   color: '#9945FF' },
  { symbol: 'XRP',  name: 'XRP',      color: '#00AAE4' },
  { symbol: 'DOGE', name: 'Dogecoin', color: '#C3A634' },
];

// Coins that trade as <SYMBOL>-USD spot on Coinbase (verified against the account).
// Anything not on Coinbase was removed: the scanner used to price those off other
// exchanges, which produced signals that could never be executed.
export const SCAN_UNIVERSE = [
  { symbol: 'BTC',    name: 'Bitcoin',           color: '#F7931A' },
  { symbol: 'ETH',    name: 'Ethereum',          color: '#627EEA' },
  { symbol: 'SOL',    name: 'Solana',            color: '#9945FF' },
  { symbol: 'XRP',    name: 'XRP',               color: '#00AAE4' },
  { symbol: 'DOGE',   name: 'Dogecoin',          color: '#C3A634' },
  { symbol: 'ADA',    name: 'Cardano',           color: '#0D9DE0' },
  { symbol: 'AVAX',   name: 'Avalanche',         color: '#E84142' },
  { symbol: 'LINK',   name: 'Chainlink',         color: '#375BD2' },
  { symbol: 'LTC',    name: 'Litecoin',          color: '#A0A0A0' },
  { symbol: 'BCH',    name: 'Bitcoin Cash',      color: '#8DC351' },
  { symbol: 'DOT',    name: 'Polkadot',          color: '#E6007A' },
  { symbol: 'NEAR',   name: 'NEAR Protocol',     color: '#00C08B' },
  { symbol: 'ATOM',   name: 'Cosmos',            color: '#6F7390' },
  { symbol: 'XLM',    name: 'Stellar',           color: '#9B59B6' },
  { symbol: 'HBAR',   name: 'Hedera',            color: '#00B9B9' },
  { symbol: 'SUI',    name: 'Sui',               color: '#4DA2FF' },
  { symbol: 'APT',    name: 'Aptos',             color: '#2D8CFF' },
  { symbol: 'ARB',    name: 'Arbitrum',          color: '#28A0F0' },
  { symbol: 'OP',     name: 'Optimism',          color: '#FF0420' },
  { symbol: 'INJ',    name: 'Injective',         color: '#00BFFF' },
  { symbol: 'ICP',    name: 'Internet Computer', color: '#29ABE2' },
  { symbol: 'ALGO',   name: 'Algorand',          color: '#00BB99' },
  { symbol: 'STX',    name: 'Stacks',            color: '#5546FF' },
  { symbol: 'TAO',    name: 'Bittensor',         color: '#B8B8B8' },
  { symbol: 'HYPE',   name: 'Hyperliquid',       color: '#50D2C1' },
  { symbol: 'RENDER', name: 'Render',            color: '#F0452B' },
  { symbol: 'ONDO',   name: 'Ondo',              color: '#5B8DEF' },
  { symbol: 'ENA',    name: 'Ethena',            color: '#C0C0C0' },
  { symbol: 'SEI',    name: 'Sei',               color: '#B01E1E' },
  { symbol: 'TIA',    name: 'Celestia',          color: '#7B2BF9' },
  { symbol: 'FET',    name: 'Fetch.ai',          color: '#6C7BFF' },
  { symbol: 'AXS',    name: 'Axie Infinity',     color: '#0055D5' },
  { symbol: 'VET',    name: 'VeChain',           color: '#15BDFF' },
  { symbol: 'CRV',    name: 'Curve',             color: '#FF8C42' },
  { symbol: 'FLOW',   name: 'Flow',              color: '#00EF8B' },
  { symbol: 'PEPE',   name: 'Pepe',              color: '#4C9540' },
];

// The Trading Desk follows the larger, more liquid names: thin coins have wide
// spreads and the trend evidence does not extend to them.
export const DESK_SYMBOLS = [
  'BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'LTC', 'BCH', 'DOT', 'NEAR', 'ATOM', 'XLM',
  'HBAR', 'SUI', 'APT', 'ARB', 'OP', 'INJ', 'ICP', 'ALGO', 'STX', 'TAO', 'HYPE', 'RENDER', 'ONDO', 'ENA',
];

// Look up any coin by symbol — covers both watchlist and scanner universe
export function findCoin(symbol) {
  return SCAN_UNIVERSE.find(c => c.symbol === symbol) ?? null;
}

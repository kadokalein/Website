// CoinGecko public API — no key required.
// Provides 7d/30d price change, market cap, ATH distance for trade context.

const GECKO_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple',
  DOGE: 'dogecoin', BNB: 'binancecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  MATIC: 'matic-network', DOT: 'polkadot', LINK: 'chainlink', LTC: 'litecoin',
  BCH: 'bitcoin-cash', ATOM: 'cosmos', NEAR: 'near', UNI: 'uniswap',
  AAVE: 'aave', FIL: 'filecoin', GRT: 'the-graph', SAND: 'the-sandbox',
  MANA: 'decentraland', AXS: 'axie-infinity', VET: 'vechain', XLM: 'stellar',
  TRX: 'tron', INJ: 'injective-protocol', APT: 'aptos', ARB: 'arbitrum',
  OP: 'optimism', STX: 'blockstack', ALGO: 'algorand', HBAR: 'hedera-hashgraph',
  ICP: 'internet-computer', FTM: 'fantom', THETA: 'theta-token',
  RUNE: 'thorchain', CRV: 'curve-dao-token', SNX: 'havven', CHZ: 'chiliz',
  ENJ: 'enjincoin', FLOW: 'flow', KAVA: 'kava', CAKE: 'pancakeswap-token',
  MINA: 'mina-protocol', IMX: 'immutable-x', EGLD: 'elrond-erd-2',
  ZIL: 'zilliqa', CFX: 'conflux-token', ONE: 'harmony', ROSE: 'oasis-network',
  BNB: 'binancecoin', SOL: 'solana',
};

export function geckoId(symbol) { return GECKO_IDS[symbol] ?? null; }

// Batch fetch market data for up to 250 coins
export async function fetchMarketData(symbols) {
  const idList = symbols.map(s => GECKO_IDS[s]).filter(Boolean);
  if (!idList.length) return {};

  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd` +
    `&ids=${idList.join(',')}` +
    `&price_change_percentage=7d,30d` +
    `&order=market_cap_desc&per_page=250&page=1`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const list = await res.json();

  const out = {};
  for (const coin of list) {
    const symbol = Object.keys(GECKO_IDS).find(s => GECKO_IDS[s] === coin.id);
    if (!symbol) continue;
    out[symbol] = {
      marketCapRank: coin.market_cap_rank,
      marketCap: coin.market_cap,             // USD
      change24h: coin.price_change_percentage_24h,
      change7d: coin.price_change_percentage_7d_in_currency,
      change30d: coin.price_change_percentage_30d_in_currency,
      ath: coin.ath,
      athChangePct: coin.ath_change_percentage, // negative = % below ATH
      volume24h: coin.total_volume,
    };
  }
  return out;
}

// Classify market cap tier
export function capTier(marketCap) {
  if (!marketCap) return 'unknown';
  if (marketCap > 10e9)  return 'large';   // > $10B
  if (marketCap > 1e9)   return 'mid';     // $1B–$10B
  if (marketCap > 100e6) return 'small';   // $100M–$1B
  return 'micro';
}

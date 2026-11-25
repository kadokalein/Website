// Paper account for the Trading Desk. Pure functions over a plain-JSON account so
// the same code drives the browser (persisted to localStorage) and the backtest.
//
// Unlike the old paper bot, every fill pays Coinbase-style fees and slippage, and
// shorts are supported (1x, fully collateralised, paper only). Each position
// remembers its own fee schedule, so crypto and stocks can share one account.

export const DEFAULT_FEES = { taker: 0.009, maker: 0.005, slippage: 0.001 };
// Coinbase charges no commission on stocks and ETFs; only the spread/slippage remains.
export const STOCK_FEES = { taker: 0, maker: 0, slippage: 0.0005 };

export const DEFAULT_RISK = {
  riskPerTradePct: 1.0,     // % of equity lost if the stop is hit, fees included
  maxPositionPct: 25,       // largest single position as % of equity
  maxPositions: 3,
  maxNewTradesPerDay: 2,
  dailyLossLimitPct: 2.0,   // no new entries for the rest of the UTC day once down this much
  maxOpenRiskPct: 3.0,      // sum of open stop-risk across positions
  maxPerSector: 2,          // diversification: at most this many open positions in one sector
};

const DAY = 86_400_000;
export const dayKey = (t) => new Date(Math.floor(t / DAY) * DAY).toISOString().slice(0, 10);

export function newAccount(startBalance = 5000, now = 0) {
  return {
    version: 1,
    startBalance,
    cash: startBalance,
    positions: {},   // sym → position
    trades: [],      // closed trades, newest first
    days: {},        // 'YYYY-MM-DD' → { startEquity, endEquity, newTrades, realized }
    createdAt: now,
    lastUpdate: now,
  };
}

export function positionValue(pos, price) {
  return pos.notional + pos.dir * (price - pos.entry) * pos.qty;
}

export function equity(acct, prices = {}) {
  let e = acct.cash;
  for (const pos of Object.values(acct.positions)) e += positionValue(pos, prices[pos.sym] ?? pos.lastPrice ?? pos.entry);
  return e;
}

export function openRiskUsd(acct) {
  let r = 0;
  for (const pos of Object.values(acct.positions)) {
    r += Math.max(0, pos.dir * (pos.entry - pos.stop)) * pos.qty;
  }
  return r;
}

function ensureDay(acct, time, eq) {
  const k = dayKey(time);
  if (!acct.days[k]) acct.days[k] = { startEquity: eq, endEquity: eq, newTrades: 0, realized: 0 };
  return acct.days[k];
}

// Record end-of-scan equity so the daily P&L calendar stays current.
export function markDay(acct, time, prices) {
  const eq = equity(acct, prices);
  const d = ensureDay(acct, time, eq);
  d.endEquity = eq;
  for (const pos of Object.values(acct.positions)) if (prices[pos.sym] != null) pos.lastPrice = prices[pos.sym];
  acct.lastUpdate = time;
  return eq;
}

// Why a new entry is not allowed right now, or null if it is.
export function entryBlock(acct, time, prices, risk = DEFAULT_RISK, sector = null) {
  const eq = equity(acct, prices);
  const d = ensureDay(acct, time, eq);
  if (Object.keys(acct.positions).length >= risk.maxPositions) return `Max ${risk.maxPositions} open positions`;
  if (sector && risk.maxPerSector) {
    const inSector = Object.values(acct.positions).filter((p) => (p.sector ?? 'crypto') === sector).length;
    if (inSector >= risk.maxPerSector) return `Already ${inSector} open position${inSector === 1 ? '' : 's'} in this sector (max ${risk.maxPerSector})`;
  }
  if (d.newTrades >= risk.maxNewTradesPerDay) return `Daily limit of ${risk.maxNewTradesPerDay} new trades reached`;
  const dayPnlPct = ((eq - d.startEquity) / d.startEquity) * 100;
  if (dayPnlPct <= -risk.dailyLossLimitPct) return `Daily loss limit hit (${dayPnlPct.toFixed(1)}%) — standing down until tomorrow`;
  if ((openRiskUsd(acct) / eq) * 100 >= risk.maxOpenRiskPct) return `Open risk already at ${risk.maxOpenRiskPct}% of equity`;
  return null;
}

// Dollars to commit so that hitting the stop costs `riskPerTradePct` of equity,
// counting the entry fee, the exit fee and slippage.
export function sizeForRisk(eq, cash, entry, stop, risk = DEFAULT_RISK, fees = DEFAULT_FEES) {
  const stopFrac = Math.abs(entry - stop) / entry;
  const lossFrac = stopFrac + 2 * fees.taker + 2 * fees.slippage;
  const byRisk = (eq * risk.riskPerTradePct) / 100 / lossFrac;
  const byCap = (eq * risk.maxPositionPct) / 100;
  return Math.max(0, Math.min(byRisk, byCap, cash * 0.98));
}

// plan: { sym, dir (+1 long / -1 short), entry, stop, target?, trailAtr?, sizeUsd, asset?, sector?, meta }
export function openPosition(acct, plan, time, fees = DEFAULT_FEES) {
  if (acct.positions[plan.sym] || plan.sizeUsd < 10) return null;
  const fill = plan.entry * (1 + plan.dir * fees.slippage);
  const fee = plan.sizeUsd * fees.taker;
  if (acct.cash < plan.sizeUsd + fee) return null;
  const pos = {
    id: `${plan.sym}-${time}`,
    sym: plan.sym, dir: plan.dir,
    qty: plan.sizeUsd / fill, entry: fill, notional: plan.sizeUsd,
    entryTime: time, entryFee: fee,
    stop: plan.stop, initialStop: plan.stop, target: plan.target ?? null,
    trailAtr: plan.trailAtr ?? null, extreme: fill,
    lastPrice: fill, meta: plan.meta ?? {},
    asset: plan.asset ?? 'crypto', sector: plan.sector ?? 'crypto', fees,
  };
  acct.cash -= plan.sizeUsd + fee;
  acct.positions[plan.sym] = pos;
  const d = ensureDay(acct, time, equity(acct) + fee);
  d.newTrades += 1;
  return pos;
}

// feeRate defaults to the position's own taker fee.
export function closePosition(acct, sym, price, reason, time, feeRate) {
  const pos = acct.positions[sym];
  if (!pos) return null;
  feeRate ??= (pos.fees ?? DEFAULT_FEES).taker;
  const gross = pos.dir * (price - pos.entry) * pos.qty;
  const exitFee = pos.qty * price * feeRate;
  const net = gross - pos.entryFee - exitFee;
  acct.cash += pos.notional + gross - exitFee;
  delete acct.positions[sym];
  const riskUsd = Math.abs(pos.entry - pos.initialStop) * pos.qty;
  const trade = {
    id: pos.id, sym, dir: pos.dir, qty: pos.qty,
    entry: pos.entry, exit: price, entryTime: pos.entryTime, exitTime: time,
    notional: pos.notional, gross, fees: pos.entryFee + exitFee, net,
    netPct: (net / pos.notional) * 100,
    r: riskUsd > 0 ? net / riskUsd : 0,
    reason, meta: pos.meta, asset: pos.asset ?? 'crypto', sector: pos.sector ?? 'crypto',
  };
  acct.trades.unshift(trade);
  const d = ensureDay(acct, time, equity(acct));
  d.realized += net;
  return trade;
}

// Advance one position through one CLOSED candle: stop first (conservative when a
// bar spans both stop and target), then target, then ratchet the trailing stop.
// `atr` is the ATR used for the chandelier trail. Returns the closed trade or null.
export function stepPosition(acct, sym, candle, atr, fees = DEFAULT_FEES) {
  const pos = acct.positions[sym];
  if (!pos) return null;
  fees = pos.fees ?? fees;
  const { dir } = pos;
  const stopHit = dir > 0 ? candle.low <= pos.stop : candle.high >= pos.stop;
  if (stopHit) {
    // A gap through the stop fills at the open, not at the stop price.
    const gapped = dir > 0 ? candle.open < pos.stop : candle.open > pos.stop;
    const px = (gapped ? candle.open : pos.stop) * (1 - dir * fees.slippage);
    const trailed = pos.stop !== pos.initialStop;
    return closePosition(acct, sym, px, trailed ? 'Trailing stop' : 'Stop loss', candle.time, fees.taker);
  }
  if (pos.target != null) {
    const targetHit = dir > 0 ? candle.high >= pos.target : candle.low <= pos.target;
    if (targetHit) return closePosition(acct, sym, pos.target, 'Target reached', candle.time, fees.maker);
  }
  pos.extreme = dir > 0 ? Math.max(pos.extreme, candle.high) : Math.min(pos.extreme, candle.low);
  if (pos.trailAtr && atr) {
    const trail = pos.extreme - dir * pos.trailAtr * atr;
    if (dir > 0 ? trail > pos.stop : trail < pos.stop) pos.stop = trail;
  }
  pos.lastPrice = candle.close;
  return null;
}

export function summarize(acct, prices = {}) {
  const eq = equity(acct, prices);
  const t = acct.trades;
  const wins = t.filter((x) => x.net > 0);
  const grossWin = wins.reduce((s, x) => s + x.net, 0);
  const grossLoss = -t.filter((x) => x.net <= 0).reduce((s, x) => s + x.net, 0);
  const days = Object.entries(acct.days).map(([k, d]) => ({ day: k, pnl: d.endEquity - d.startEquity, pct: ((d.endEquity - d.startEquity) / d.startEquity) * 100 }));
  const active = days.filter((d) => Math.abs(d.pnl) > 0.005);
  return {
    equity: eq,
    totalPnl: eq - acct.startBalance,
    totalPct: ((eq - acct.startBalance) / acct.startBalance) * 100,
    trades: t.length,
    winRate: t.length ? (wins.length / t.length) * 100 : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgR: t.length ? t.reduce((s, x) => s + x.r, 0) / t.length : null,
    feesPaid: t.reduce((s, x) => s + x.fees, 0) + Object.values(acct.positions).reduce((s, p) => s + p.entryFee, 0),
    greenDays: active.filter((d) => d.pnl > 0).length,
    redDays: active.filter((d) => d.pnl < 0).length,
    days,
  };
}

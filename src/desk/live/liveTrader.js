// Automatic LIVE trading on Coinbase (real money). It copies the Trading Desk's
// paper decisions: when the paper account opens a position, this buys the same
// coin or stock on Coinbase (sized by the live balance); when the paper account
// closes it, this sells. It runs only while the site is open in a browser with
// the owner's local proxy running.
//
// Rules: 1% of live equity at risk per trade, at most 3 open positions and 2 per
// sector, no new buys after a 2% loss on the day, and Auto Trade pauses itself
// after 3 failed orders in a row. Crypto gets a resting stop-loss order on
// Coinbase; stocks cannot have one (Coinbase has no stock stop orders), so the bot
// sells a stock itself when its price reaches the stop during market hours.

import { createCoinbaseClient, checkProxy, describeCoinbaseError } from '../../lib/coinbaseApi';
import { loadKeys, signedRequestsReady, PROXY_URL } from '../../lib/coinbaseKeys';
import { notify, askConfirm } from '../../lib/notify';
import { pageLink } from '../../lib/platform';
import { loadLive, saveLive, addLiveLog, pingLive, setMode } from './liveStore';

export const LIVE_RULES = { riskPct: 1, maxPositions: 3, maxPerSector: 2, dailyLossPct: 2, maxFailures: 3 };
const CRYPTO_ROUND_TRIP = 0.018;   // Coinbase taker fee, both ways
const SLIPPAGE = 0.001;
const STOP_LIMIT_GAP = 0.015;      // crypto stop-limit sells up to 1.5% below the stop price
const CONFIRM_TTL = 120_000;
const MAX_ENTRY_DRIFT = 0.01;      // after a confirm, the price may not have run more than 1%

let running = false;
let chain = Promise.resolve();
let latestPrices = {};
let latestMarketOpen = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
// Link for notifications: the page on this site, or an app link in the iPhone app.
const siteUrl = (hash) => pageLink(hash);
const money = (v) => `$${Number(v).toFixed(2)}`;
const px = (v) => (v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
const qt = (q) => String(Number(Number(q).toFixed(q >= 1 ? 4 : 6)));

// Run one job at a time (cycles, confirmations and manual closes never overlap).
function serial(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

export function liveStatus() {
  return { ...loadLive(), running };
}

function decimals(inc) {
  const s = String(inc ?? '');
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.replace(/0+$/, '').length - i - 1;
}
function floorTo(x, inc) {
  const d = decimals(inc || '0.00000001');
  const f = 10 ** d;
  return Math.floor(x * f + 1e-9) / f;
}

function client() {
  const keys = loadKeys();
  return createCoinbaseClient(keys.apiKey, keys.apiSecret, PROXY_URL);
}

// Why the trader cannot act right now, or null.
async function blocker() {
  const keys = loadKeys();
  if (!keys?.apiKey || !keys?.apiSecret) return 'No Coinbase API key is saved in this browser.';
  if (!signedRequestsReady()) return 'The local proxy is switched off on the Live page.';
  try { await checkProxy(PROXY_URL); } catch (e) { return describeCoinbaseError(e).summary; }
  return null;
}

// Live equity, cash and holdings. Stocks are not in /accounts — they come from the portfolio breakdown.
async function readAccount(c) {
  const acc = await c.getAllAccounts();
  let cash = 0;
  const crypto = {};
  for (const a of acc.accounts ?? []) {
    const v = Number(a.available_balance?.value ?? 0);
    if (!(v > 0)) continue;
    if (a.currency === 'USD' || a.currency === 'USDC') cash += v;
    else crypto[a.currency] = (crypto[a.currency] ?? 0) + v;
  }
  let equity = null;
  const equities = {};
  try {
    const ports = await c.listPortfolios();
    const list = ports?.portfolios ?? [];
    const def = list.find((p) => p.type === 'DEFAULT') ?? list[0];
    if (def?.uuid) {
      const b = await c.getPortfolioBreakdown(def.uuid);
      const bd = b?.breakdown ?? b ?? {};
      const total = Number(bd.portfolio_balances?.total_balance?.value);
      if (total > 0) equity = total;
      const seen = new Set();
      for (const p of bd.equity_positions ?? []) {
        if (!p?.asset || seen.has(p.account_uuid)) continue;
        seen.add(p.account_uuid);
        equities[p.asset] = Number(p.available_to_trade_equity ?? p.total_balance_equity ?? 0);
      }
    }
  } catch { /* fall back to cash + crypto at market prices */ }
  if (equity == null) {
    equity = cash;
    for (const [sym, qty] of Object.entries(crypto)) if (latestPrices[sym]) equity += qty * latestPrices[sym];
  }
  return { equity, cash, crypto, equities };
}

// Wrong-asset guard: CVX-USD on Coinbase is a crypto token, not Chevron.
async function checkProduct(c, sym, asset) {
  const productId = `${sym}-USD`;
  const p = await c.getProduct(productId);
  if (asset === 'stock' && p?.product_type !== 'EQUITY') throw new Error(`${productId} on Coinbase is not a stock (it is ${p?.product_type ?? 'unknown'}) — skipped`);
  if (asset === 'crypto' && (p?.product_type && p.product_type !== 'SPOT')) throw new Error(`${productId} is not a spot crypto product — skipped`);
  if (p?.trading_disabled || (p?.status && !['online', 'ONLINE'].includes(p.status) && asset === 'crypto')) throw new Error(`${productId} is not tradable right now`);
  return {
    productId,
    quoteMin: Math.max(asset === 'stock' ? 1 : 0, Number(p?.quote_min_size) || 1),
    baseInc: p?.base_increment || (asset === 'stock' ? '0.00001' : '0.00000001'),
    priceInc: p?.price_increment || p?.quote_increment || '0.01',
  };
}

// Poll an order until it fills or ends. Returns the order, or null if still working.
async function waitFill(c, orderId) {
  for (let i = 0; i < 10; i++) {
    const o = (await c.getOrder(orderId))?.order;
    if (o?.status === 'FILLED') return o;
    if (['CANCELLED', 'EXPIRED', 'FAILED'].includes(o?.status)) throw new Error(`order ${o.status.toLowerCase()}${o.reject_message ? `: ${o.reject_message}` : ''}`);
    await sleep(1000);
  }
  return null;
}

function failure(text) {
  const s = saveLive((x) => { x.consecutiveFailures = (x.consecutiveFailures ?? 0) + 1; });
  addLiveLog('error', text);
  notify({ title: 'Live trade problem', message: text, event: 'liveTrades', priority: 4, url: siteUrl('#/live') });
  if (s.consecutiveFailures >= LIVE_RULES.maxFailures && s.mode !== 'off') {
    setMode('off', 'safety stop');
    addLiveLog('error', `Auto Trade paused after ${LIVE_RULES.maxFailures} failed orders in a row. Last problem: ${text}`);
    notify({ title: 'Auto Trade paused', message: `Paused after ${LIVE_RULES.maxFailures} failed orders in a row: ${text}`, event: 'liveTrades', priority: 5, url: siteUrl('#/live') });
  }
}

// ── Entries ──────────────────────────────────────────────────────────────────
async function placeEntry(c, plan) {
  const { sym, asset, sector, sectorLabel, stop, sizeUsd, clientOrderId } = plan;
  let prod;
  try { prod = await checkProduct(c, sym, asset); } catch (e) { addLiveLog('info', `Skipped ${sym}: ${e.message}`); return; }
  saveLive((s) => { s.positions[sym] = { sym, asset, sector, productId: prod.productId, qty: 0, entryPrice: plan.price, entryTime: Date.now(), stop, initialStop: stop, exitLevel: plan.exitLevel ?? null, stopOrderId: null, clientOrderId, status: 'pending', cost: 0 }; });
  try {
    const size = sizeUsd.toFixed(2);
    const res = asset === 'stock'
      ? await c.placeEquityMarketBuy(clientOrderId, prod.productId, size)
      : await c.placeMarketBuy(clientOrderId, prod.productId, size);
    const orderId = res?.success_response?.order_id ?? res?.order_id;
    if (!orderId) throw new Error('Coinbase did not return an order id');
    const fill = await waitFill(c, orderId);
    if (!fill) {
      saveLive((s) => { if (s.positions[sym]) s.positions[sym].orderId = orderId; });
      addLiveLog('buy', `Buy order for ${sym} sent (${money(sizeUsd)}); waiting for Coinbase to report the fill.`);
      return;
    }
    const qty = Number(fill.filled_size);
    const avg = Number(fill.average_filled_price);
    saveLive((s) => {
      s.consecutiveFailures = 0;
      const p = s.positions[sym];
      if (p) Object.assign(p, { qty, entryPrice: avg, cost: Number(fill.filled_value ?? qty * avg) + Number(fill.total_fees ?? 0), status: 'open', orderId });
    });
    addLiveLog('buy', `Bought ${qt(qty)} ${sym} at $${px(avg)} (${money(qty * avg)}), stop $${px(stop)}.`);
    notify({ title: `Live trade placed: BUY ${qt(qty)} ${sym} @ $${px(avg)}`, message: `${sectorLabel ?? sector} · ${money(qty * avg)} · stop $${px(stop)}`, event: 'liveTrades', priority: 4, url: siteUrl('#/live'), sequenceId: `trd_${clientOrderId}` });
    if (asset === 'crypto') await protect(c, sym, prod);
    else addLiveLog('info', `${sym}: Coinbase has no stop orders for stocks — the bot will sell if it trades at or below $${px(stop)} during market hours, so keep the site open on trading days.`);
  } catch (e) {
    saveLive((s) => { delete s.positions[sym]; });
    failure(`Could not buy ${sym}: ${describeCoinbaseError(e).summary}`);
  }
}

// Resting stop-limit SELL for a crypto position.
async function protect(c, sym, prod) {
  const pos = loadLive().positions[sym];
  if (!pos || !(pos.qty > 0)) return;
  const qty = floorTo(pos.qty, prod.baseInc);
  const limit = floorTo(pos.stop * (1 - STOP_LIMIT_GAP), prod.priceInc);
  const stopPrice = floorTo(pos.stop, prod.priceInc);
  try {
    const res = await c.placeStopLimitSell(`${pos.clientOrderId}-stop-${Date.now().toString(36)}`, prod.productId, String(qty), String(stopPrice), String(limit));
    const id = res?.success_response?.order_id ?? res?.order_id;
    saveLive((s) => { if (s.positions[sym]) s.positions[sym].stopOrderId = id ?? null; });
    addLiveLog('info', `Stop-loss order placed on Coinbase for ${sym} at $${px(stopPrice)}.`);
  } catch (e) {
    addLiveLog('error', `${sym} has NO stop-loss order on Coinbase (${describeCoinbaseError(e).summary}). The bot will watch it while the site is open.`);
    notify({ title: `${sym} is not protected by a stop order`, message: 'Placing the stop-loss on Coinbase failed. The bot watches it while the site is open.', event: 'liveTrades', priority: 5, url: siteUrl('#/live') });
  }
}

// ── Exits ────────────────────────────────────────────────────────────────────
async function exitPosition(c, sym, reason) {
  const pos = loadLive().positions[sym];
  if (!pos) return;
  saveLive((s) => { if (s.positions[sym]) s.positions[sym].status = 'closing'; });
  if (pos.asset === 'stock' && !latestMarketOpen) {
    addLiveLog('info', `${sym}: ${reason} — the stock market is closed, so it will be sold at the next regular session.`);
    return;
  }
  try {
    if (pos.stopOrderId) { try { await c.cancelOrders([pos.stopOrderId]); } catch { /* may already be filled or cancelled */ } }
    const prod = await checkProduct(c, sym, pos.asset);
    const acct = await readAccount(c);
    const held = pos.asset === 'stock' ? acct.equities[sym] ?? 0 : acct.crypto[sym] ?? 0;
    const qty = floorTo(Math.min(pos.qty || held, held), prod.baseInc);
    if (!(qty > 0)) {
      saveLive((s) => { delete s.positions[sym]; });
      addLiveLog('info', `${sym}: nothing left to sell on Coinbase (it may already have been sold by its stop order).`);
      return;
    }
    const id = `${pos.clientOrderId}-exit-${Date.now().toString(36)}`;
    const res = pos.asset === 'stock' ? await c.placeEquityMarketSell(id, prod.productId, String(qty)) : await c.placeMarketSell(id, prod.productId, String(qty));
    const orderId = res?.success_response?.order_id ?? res?.order_id;
    const fill = orderId ? await waitFill(c, orderId) : null;
    const avg = Number(fill?.average_filled_price) || latestPrices[sym] || pos.entryPrice;
    const proceeds = qty * avg - Number(fill?.total_fees ?? 0);
    const pnl = proceeds - (pos.cost || pos.qty * pos.entryPrice) * (qty / (pos.qty || qty));
    saveLive((s) => {
      delete s.positions[sym];
      s.consecutiveFailures = 0;
      const d = (s.days[dayKey(Date.now())] ??= { startEquity: acct.equity, realized: 0 });
      d.realized = (d.realized ?? 0) + pnl;
    });
    addLiveLog('sell', `Sold ${qt(qty)} ${sym} at $${px(avg)} — ${reason} — ${pnl >= 0 ? '+' : '-'}${money(Math.abs(pnl))}.`);
    notify({ title: `Live trade closed: SELL ${sym} ${pnl >= 0 ? '+' : '-'}${money(Math.abs(pnl))}`, message: `${reason} · ${qt(qty)} at $${px(avg)}`, event: 'liveTrades', priority: 4, url: siteUrl('#/live') });
  } catch (e) {
    failure(`Could not sell ${sym}: ${describeCoinbaseError(e).summary}`);
  }
}

// Manual "Close now" from the Live page.
export function closeLivePosition(sym) {
  return serial(async () => {
    const why = await blocker();
    if (why) { addLiveLog('error', `Could not close ${sym}: ${why}`); return; }
    await exitPosition(client(), sym, 'Closed by hand');
  });
}

// ── One cycle, after every desk run ──────────────────────────────────────────
// opened/closed: the desk's paper positions opened and trades closed in this run.
export function runLiveCycle({ now = Date.now(), opened = [], closed = [], paperPositions = {}, prices = {}, stockMarketOpen = false } = {}) {
  latestPrices = { ...latestPrices, ...prices };
  latestMarketOpen = !!stockMarketOpen;
  if (loadLive().mode === 'off') return Promise.resolve();
  return serial(async () => {
    running = true;
    pingLive();
    let text = 'Checked — nothing to do.';
    let ok = true;
    try {
      if (loadLive().mode === 'off') return;
      const why = await blocker();
      if (why) { ok = false; text = why; return; }
      const c = client();
      const acct = await readAccount(c);
      const day = dayKey(now);
      saveLive((s) => {
        s.account = { equity: acct.equity, cash: acct.cash, time: now };
        s.days[day] ??= { startEquity: acct.equity, realized: 0 };
      });
      const today = loadLive().days[day];
      const downPct = today.startEquity > 0 ? ((acct.equity - today.startEquity) / today.startEquity) * 100 : 0;
      const halted = downPct <= -LIVE_RULES.dailyLossPct;
      if (halted && !today.halted) {
        saveLive((s) => { s.days[day].halted = true; });
        addLiveLog('info', `Down ${downPct.toFixed(1)}% today — no new live buys until tomorrow (UTC).`);
        notify({ title: 'Live trading: daily loss limit reached', message: `Down ${downPct.toFixed(1)}% today. No new buys until tomorrow; exits still run.`, event: 'liveTrades', priority: 4, url: siteUrl('#/live') });
      }

      // 1) The desk closed a position → sell it live.
      for (const t of closed) if (loadLive().positions[t.sym]) await exitPosition(c, t.sym, `the desk closed it (${t.reason})`);

      // 2) Stops, pending fills and unfinished exits.
      for (const pos of Object.values(loadLive().positions)) {
        const price = latestPrices[pos.sym];
        if (pos.status === 'pending' && pos.orderId) {
          try {
            const fill = await waitFill(c, pos.orderId);
            if (fill) saveLive((s) => { const p = s.positions[pos.sym]; if (p) Object.assign(p, { qty: Number(fill.filled_size), entryPrice: Number(fill.average_filled_price), status: 'open' }); });
          } catch (e) { saveLive((s) => { delete s.positions[pos.sym]; }); addLiveLog('error', `Buy of ${pos.sym} did not complete: ${e.message}`); }
          continue;
        }
        if (pos.status === 'closing') { await exitPosition(c, pos.sym, 'finishing an earlier sell'); continue; }
        if (pos.asset === 'crypto' && pos.stopOrderId) {
          try {
            const o = (await c.getOrder(pos.stopOrderId))?.order;
            if (o?.status === 'FILLED') {
              const avg = Number(o.average_filled_price);
              const pnl = Number(o.filled_size) * avg - Number(o.total_fees ?? 0) - (pos.cost || pos.qty * pos.entryPrice);
              saveLive((s) => { delete s.positions[pos.sym]; const d = (s.days[day] ??= { startEquity: acct.equity, realized: 0 }); d.realized = (d.realized ?? 0) + pnl; });
              addLiveLog('sell', `${pos.sym} stop-loss order filled at $${px(avg)} — ${pnl >= 0 ? '+' : '-'}${money(Math.abs(pnl))}.`);
              notify({ title: `Stop-loss filled: ${pos.sym}`, message: `Sold at $${px(avg)} (${pnl >= 0 ? '+' : '-'}${money(Math.abs(pnl))})`, event: 'liveTrades', priority: 4, url: siteUrl('#/live') });
              continue;
            }
          } catch { /* check again next cycle */ }
        }
        const watched = pos.asset === 'stock' ? latestMarketOpen : !pos.stopOrderId;
        if (watched && price != null && price <= pos.stop) { await exitPosition(c, pos.sym, `stop hit at $${px(price)}`); continue; }
        // Follow the desk when it raises the stop.
        const paper = paperPositions[pos.sym];
        if (paper && paper.stop > pos.stop * 1.005) {
          saveLive((s) => { if (s.positions[pos.sym]) s.positions[pos.sym].stop = paper.stop; });
          addLiveLog('info', `${pos.sym}: stop raised to $${px(paper.stop)} to follow the desk.`);
          if (pos.asset === 'crypto' && pos.stopOrderId) {
            try { await c.cancelOrders([pos.stopOrderId]); } catch { /* re-placed below */ }
            saveLive((s) => { if (s.positions[pos.sym]) s.positions[pos.sym].stopOrderId = null; });
            try { await protect(c, pos.sym, await checkProduct(c, pos.sym, 'crypto')); } catch { /* logged in protect */ }
          }
        }
      }

      // 3) The desk opened a position → buy it live.
      if (!halted) {
        for (const p of opened) {
          const handledKey = String(p.id);
          if (loadLive().handled[handledKey]) continue;
          saveLive((s) => { s.handled[handledKey] = now; });
          const plan = sizeEntry(p, acct);
          if (plan.skip) { addLiveLog('info', `Skipped ${p.sym}: ${plan.skip}`); continue; }
          if (loadLive().mode === 'confirm') { requestConfirm(plan); continue; }
          await placeEntry(c, plan);
        }
      }
      const s = loadLive();
      const n = Object.keys(s.positions).length;
      text = `Checked ${n} live position${n === 1 ? '' : 's'}; Coinbase balance ${money(acct.equity)} (cash ${money(acct.cash)}).`;
    } catch (e) {
      ok = false;
      text = `Live cycle failed: ${describeCoinbaseError(e).summary}`;
    } finally {
      running = false;
      saveLive({ lastCycle: { time: now, ok, text } });
    }
  });
}

// Size a live entry from a paper position. → plan or { skip: reason }
function sizeEntry(p, acct) {
  const s = loadLive();
  const open = Object.values(s.positions);
  if (open.length >= LIVE_RULES.maxPositions) return { skip: `already ${LIVE_RULES.maxPositions} live positions` };
  if (open.filter((x) => x.sector === p.sector).length >= LIVE_RULES.maxPerSector) return { skip: `already ${LIVE_RULES.maxPerSector} live positions in this sector` };
  if (s.positions[p.sym]) return { skip: 'already held live' };
  const asset = p.asset ?? 'crypto';
  if (asset === 'stock' && !latestMarketOpen) return { skip: 'the stock market is closed' };
  const price = latestPrices[p.sym] ?? p.entry;
  const stopPct = (price - p.stop) / price;
  if (!(stopPct > 0)) return { skip: 'price is already at or below the stop' };
  const costs = asset === 'crypto' ? CRYPTO_ROUND_TRIP + SLIPPAGE : SLIPPAGE;
  const byRisk = (acct.equity * LIVE_RULES.riskPct) / 100 / (stopPct + costs);
  const sizeUsd = Math.floor(Math.min(byRisk, acct.cash * 0.98) * 100) / 100;
  const minimum = asset === 'stock' ? 1 : 1;
  if (!(sizeUsd >= minimum)) return { skip: `not enough cash on Coinbase (would need at least ${money(minimum)}, have ${money(acct.cash)})` };
  return {
    sym: p.sym, asset, sector: p.sector ?? 'crypto', sectorLabel: p.meta?.sectorLabel, price, stop: p.stop, stopPct,
    exitLevel: p.meta?.exitLevel ?? null, sizeUsd,
    clientOrderId: `pp-${String(p.id).replace(/[^A-Za-z0-9]/g, '').slice(-24)}`,
  };
}

// Ask the owner to confirm, then place the order only on "confirm" and only if the price has not run away.
function requestConfirm(plan) {
  const { promise } = askConfirm({
    id: plan.clientOrderId,
    title: `Confirm trade? BUY ${plan.sym} ~${money(plan.sizeUsd)}`,
    message: `${plan.sectorLabel ?? plan.sector} · stop $${px(plan.stop)} (${(plan.stopPct * 100).toFixed(1)}% below) · expires in 2 min — no answer = not placed`,
    ttlMs: CONFIRM_TTL,
    url: siteUrl('#/live'),
  });
  addLiveLog('confirm', `Waiting for your Confirm: BUY ${plan.sym} ~${money(plan.sizeUsd)}.`);
  promise.then((decision) => serial(async () => {
    if (decision !== 'confirm') { addLiveLog('confirm', `${plan.sym}: ${decision === 'reject' ? 'rejected' : 'no answer in time'} — not placed.`); return; }
    if (loadLive().mode === 'off') { addLiveLog('confirm', `${plan.sym}: confirmed, but automatic trading was switched off — not placed.`); return; }
    const now = latestPrices[plan.sym] ?? plan.price;
    if (now > plan.price * (1 + MAX_ENTRY_DRIFT)) { addLiveLog('confirm', `${plan.sym}: confirmed, but the price moved more than 1% while waiting — not placed.`); return; }
    const why = await blocker();
    if (why) { addLiveLog('error', `${plan.sym}: confirmed, but ${why}`); return; }
    addLiveLog('confirm', `${plan.sym}: confirmed — placing the order.`);
    await placeEntry(client(), { ...plan, price: now });
  })).catch(() => {});
}

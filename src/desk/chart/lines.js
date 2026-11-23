// "Drawing lines" on a chart: swing pivots, horizontal support/resistance zones,
// diagonal trendlines, and market structure. Pure functions over CLOSED candles —
// callers must not pass a still-forming bar.

// A swing high is a bar whose high exceeds the highs of `left` bars before and
// `right` bars after it (mirror for swing lows). The last `right` bars can never
// be pivots yet, which is what keeps this free of look-ahead.
export function findPivots(candles, left = 3, right = 3) {
  const out = [];
  for (let i = left; i < candles.length - right; i++) {
    const h = candles[i].high, l = candles[i].low;
    let isH = true, isL = true;
    for (let j = i - left; j <= i + right && (isH || isL); j++) {
      if (j === i) continue;
      if (candles[j].high > h || (j < i && candles[j].high === h)) isH = false;
      if (candles[j].low < l || (j < i && candles[j].low === l)) isL = false;
    }
    if (isH) out.push({ i, time: candles[i].time, price: h, type: 'H' });
    if (isL) out.push({ i, time: candles[i].time, price: l, type: 'L' });
  }
  return out;
}

// Collapse runs of same-type pivots to the most extreme one, giving an
// alternating high/low sequence.
export function zigzag(pivots) {
  const out = [];
  for (const p of pivots) {
    const prev = out[out.length - 1];
    if (prev && prev.type === p.type) {
      const moreExtreme = p.type === 'H' ? p.price > prev.price : p.price < prev.price;
      if (moreExtreme) out[out.length - 1] = p;
    } else out.push(p);
  }
  return out;
}

// Dow-theory structure from the last two swing highs and lows.
export function marketStructure(pivots) {
  const zz = zigzag(pivots);
  const highs = zz.filter((p) => p.type === 'H');
  const lows = zz.filter((p) => p.type === 'L');
  if (highs.length < 2 || lows.length < 2) return { trend: 'unknown', highs, lows };
  const [h1, h2] = highs.slice(-2);
  const [l1, l2] = lows.slice(-2);
  const hh = h2.price > h1.price, hl = l2.price > l1.price;
  let trend = 'range';
  if (hh && hl) trend = 'up';
  else if (!hh && !hl) trend = 'down';
  return { trend, hh, hl, lastHigh: h2, prevHigh: h1, lastLow: l2, prevLow: l1, highs, lows };
}

// Horizontal support/resistance: cluster pivot prices that sit within `tol` of
// each other. More touches, touches from both sides (role reversal) and recent
// touches make a stronger zone.
export function findLevels(candles, pivots, tol, { minTouches = 2, recentBars = 60 } = {}) {
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const p of sorted) {
    const c = clusters[clusters.length - 1];
    if (c && p.price - c.sum / c.pivots.length <= tol) { c.pivots.push(p); c.sum += p.price; }
    else clusters.push({ pivots: [p], sum: p.price });
  }
  const lastIdx = candles.length - 1;
  return clusters
    .map((c) => {
      const prices = c.pivots.map((p) => p.price);
      const highs = c.pivots.filter((p) => p.type === 'H').length;
      const lows = c.pivots.length - highs;
      const lastTouch = Math.max(...c.pivots.map((p) => p.i));
      const touches = c.pivots.length;
      const strength = touches + (highs > 0 && lows > 0 ? 1 : 0) + (lastIdx - lastTouch <= recentBars ? 0.5 : 0);
      return {
        price: c.sum / touches,
        lo: Math.min(...prices), hi: Math.max(...prices),
        touches, highs, lows,
        roleReversal: highs > 0 && lows > 0,
        firstTouch: Math.min(...c.pivots.map((p) => p.i)),
        lastTouch,
        firstTime: Math.min(...c.pivots.map((p) => p.time)),
        strength,
      };
    })
    .filter((z) => z.touches >= minTouches)
    .sort((a, b) => a.price - b.price);
}

// Best-fit diagonal line through swing lows (support) or swing highs (resistance).
// Works in log-price so a line means "constant % per bar". A candidate line joins
// two pivots; it is valid only if no candle between them CLOSED through it, and it
// is scored by how many pivots touch it, how long it spans, and how recently it
// was respected. Returns null when no valid line exists.
export function fitTrendline(candles, pivots, kind, tol, {
  maxPivots = 8, minSpan = 10, breakTolMult = 1, maxSlopePctPerBar = 1.5,
} = {}) {
  const type = kind === 'support' ? 'L' : 'H';
  const pts = pivots.filter((p) => p.type === type).slice(-maxPivots);
  const n = candles.length;
  if (pts.length < 2 || n < minSpan + 2) return null;
  const lastIdx = n - 1;
  const price = candles[lastIdx].close;
  const tolLog = tol / price;
  const sign = kind === 'support' ? 1 : -1; // support: closes must stay above the line
  let best = null;

  for (let x = 0; x < pts.length - 1; x++) {
    for (let y = x + 1; y < pts.length; y++) {
      const a = pts[x], b = pts[y];
      const span = b.i - a.i;
      if (span < minSpan) continue;
      const la = Math.log(a.price), lb = Math.log(b.price);
      const slope = (lb - la) / span;
      if (Math.abs(slope) * 100 > maxSlopePctPerBar) continue;
      const at = (i) => la + slope * (i - a.i);

      // No close through the line between the anchors.
      let valid = true;
      for (let i = a.i + 1; i < b.i; i++) {
        if (sign * (Math.log(candles[i].close) - at(i)) < -tolLog * breakTolMult) { valid = false; break; }
      }
      if (!valid) continue;

      // After the second anchor: first close through the line = the break.
      let brokenAt = null;
      for (let i = b.i + 1; i <= lastIdx; i++) {
        if (sign * (Math.log(candles[i].close) - at(i)) < -tolLog * breakTolMult) { brokenAt = i; break; }
      }

      const touching = pts.filter((p) => Math.abs(Math.log(p.price) - at(p.i)) <= tolLog);
      const touches = touching.length;
      const lastTouch = Math.max(...touching.map((p) => p.i));
      const score = touches * 2 + Math.min((lastIdx - a.i) / 40, 2.5) + (lastIdx - lastTouch <= 30 ? 1 : 0)
        - (brokenAt != null && lastIdx - brokenAt > 6 ? 3 : 0);
      if (!best || score > best.score) {
        best = {
          kind, a, b, slope, touches, lastTouch, brokenAt, score,
          slopePctPerBar: slope * 100,
          valueAt: (i) => Math.exp(at(i)),
          valueNow: Math.exp(at(lastIdx)),
        };
      }
    }
  }
  return best;
}

// Classify the shape made by the support and resistance lines.
export function classifyShape(support, resistance, flatPctPerBar = 0.04) {
  if (!support || !resistance) return null;
  const s = support.slopePctPerBar, r = resistance.slopePctPerBar;
  const flat = (v) => Math.abs(v) <= flatPctPerBar;
  if (flat(s) && flat(r)) return { name: 'Range (box)', bias: 'neutral' };
  if (flat(r) && s > flatPctPerBar) return { name: 'Ascending triangle', bias: 'bullish' };
  if (flat(s) && r < -flatPctPerBar) return { name: 'Descending triangle', bias: 'bearish' };
  if (s > 0 && r > 0) return s > r * 1.5 ? { name: 'Rising wedge', bias: 'bearish' } : { name: 'Rising channel', bias: 'bullish' };
  if (s < 0 && r < 0) return r < s * 1.5 ? { name: 'Falling wedge', bias: 'bullish' } : { name: 'Falling channel', bias: 'bearish' };
  if (s > 0 && r < 0) return { name: 'Symmetrical triangle', bias: 'neutral' };
  return { name: 'Broadening', bias: 'neutral' };
}

// Nearest zone strictly below / above a price.
export function nearestBelow(levels, price) {
  let best = null;
  for (const z of levels) if (z.price < price && (!best || z.price > best.price)) best = z;
  return best;
}
export function nearestAbove(levels, price) {
  let best = null;
  for (const z of levels) if (z.price > price && (!best || z.price < best.price)) best = z;
  return best;
}

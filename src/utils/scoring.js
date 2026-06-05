// Weighted run-setup scoring engine.
// Weights: Volume 35%, MACD 25%, RSI 20%, BB 10%, ATR 10%
// Philosophy: detect state CHANGE (inactive → active), not static condition stacking.

export function computeRunScore(analysis) {
  if (!analysis) return null;

  const {
    rsi, rsiTrend, macd, volume, bb,
    atrPercentile, currentPrice, volumeJustSpiked, conditions,
  } = analysis;

  const ratio = volume?.ratio ?? 0;

  // ── VOLUME (35 pts) ────────────────────────────────────────────────────────
  // Full only if ≥ 2×; partial linear from 1.2× to 2×; zero below 1.2×.
  // Volume is REQUIRED — any signal without it is downgraded.
  let volumeScore;
  if (ratio >= 2.0) {
    volumeScore = 35;
  } else if (ratio >= 1.2) {
    volumeScore = Math.round(35 * (ratio - 1.2) / 0.8 * 0.6); // max ~21 pts for partial
  } else {
    volumeScore = 0;
  }

  // ── MACD (25 pts) ──────────────────────────────────────────────────────────
  // Full if crossover JUST fired. Partial if histogram rising (momentum building).
  // Zero if bearish and histogram not improving.
  let macdScore;
  if (macd?.isBullishCrossover) {
    macdScore = 25;
  } else if (macd?.status === 'bullish' && macd?.isHistogramRising) {
    macdScore = 15; // bullish and gaining strength
  } else if (macd?.isHistogramRising && macd?.histogram != null && macd.histogram > -0.001 * (currentPrice ?? 1)) {
    macdScore = 8;  // histogram rising, approaching crossover
  } else if (macd?.isHistogramRising) {
    macdScore = 5;  // histogram rising from deep bearish
  } else {
    macdScore = 0;
  }

  // ── RSI (20 pts) ───────────────────────────────────────────────────────────
  // Full if < 30 AND curling upward (reversal confirmed).
  // Partial if < 35 but still falling (oversold without momentum).
  // Zero otherwise.
  let rsiScore;
  if (rsi != null && rsi < 30 && rsiTrend === 'rising') {
    rsiScore = 20;
  } else if (rsi != null && rsi < 35 && rsiTrend === 'rising') {
    rsiScore = 14;
  } else if (rsi != null && rsi < 30) {
    rsiScore = 10; // deeply oversold but not yet curling
  } else if (rsi != null && rsi < 35) {
    rsiScore = 6;  // oversold but still falling — partial
  } else {
    rsiScore = 0;
  }

  // ── BOLLINGER BANDS (10 pts) ───────────────────────────────────────────────
  let bbScore;
  if (conditions?.bbLower) {
    bbScore = 10; // at or below lower band
  } else if (currentPrice != null && bb?.lower != null && currentPrice <= bb.lower * 1.02) {
    bbScore = 5;  // within 2% of lower band
  } else if (currentPrice != null && bb?.lower != null && currentPrice <= bb.lower * 1.05) {
    bbScore = 2;  // within 5%
  } else {
    bbScore = 0;
  }

  // ── ATR (10 pts) ───────────────────────────────────────────────────────────
  // Low ATR = compression before potential breakout. High ATR = unstable.
  let atrScore;
  if (atrPercentile < 20) {
    atrScore = 10;
  } else if (atrPercentile < 50) {
    atrScore = 5;
  } else if (atrPercentile < 80) {
    atrScore = 2;
  } else {
    atrScore = 0; // extremely high — too unstable
  }

  const totalScore = volumeScore + macdScore + rsiScore + bbScore + atrScore;

  // ── STATE CHANGE DETECTION ─────────────────────────────────────────────────
  // "BUY TRIGGERED" requires ≥1 of these JUST happened + volume present.
  const stateChanges = [];
  if (volumeJustSpiked) stateChanges.push('Volume spike crossed 2× average');
  if (macd?.isBullishCrossover) stateChanges.push('MACD bullish crossover');
  if (rsi != null && rsi < 35 && rsiTrend === 'rising') stateChanges.push('RSI reversing from oversold');

  const hasStateChange  = stateChanges.length > 0;
  const hasVolume       = ratio >= 1.2;
  const hasStrongVolume = ratio >= 2.0;

  // ── SIGNAL ─────────────────────────────────────────────────────────────────
  let signal, triggerReason;

  if (totalScore >= 80 && hasStateChange && hasStrongVolume) {
    signal = 'BUY TRIGGERED';
    triggerReason = stateChanges.join(' · ');
  } else if (totalScore >= 60 && hasVolume) {
    signal = 'WATCH';
    triggerReason = null;
  } else if (totalScore >= 40) {
    signal = 'LOW QUALITY';
    triggerReason = null;
  } else {
    signal = 'NO SIGNAL';
    triggerReason = null;
  }

  // State label for display
  let stateLabel;
  if      (totalScore >= 80) stateLabel = 'HIGH SETUP';
  else if (totalScore >= 60) stateLabel = 'FORMING';
  else if (totalScore >= 40) stateLabel = 'LOW QUALITY';
  else                        stateLabel = 'NO TRADE';

  return {
    score: totalScore,
    stateLabel,
    signal,
    triggerReason,
    stateChanges,
    breakdown: {
      volume: { score: volumeScore, max: 35, label: 'Volume',  ratio },
      macd:   { score: macdScore,   max: 25, label: 'MACD' },
      rsi:    { score: rsiScore,    max: 20, label: 'RSI' },
      bb:     { score: bbScore,     max: 10, label: 'BB' },
      atr:    { score: atrScore,    max: 10, label: 'ATR' },
    },
  };
}

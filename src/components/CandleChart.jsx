import { useEffect, useMemo, useRef } from 'react';
import {
  createChart, ColorType, LineStyle, CrosshairMode,
  CandlestickSeries, HistogramSeries, LineSeries,
} from 'lightweight-charts';

// Presentational candlestick chart: candles + volume, with optional horizontal
// price lines and diagonal line segments drawn on top. It knows nothing about
// what the lines mean — callers decide what to draw.

const UP = '#3fb950';
const DOWN = '#f85149';
const VISIBLE_BARS = 120;
const RIGHT_PAD_BARS = 4;
const NO_LINES = [];

const LINE_STYLES = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const lineStyle = (s) => LINE_STYLES[s] ?? LineStyle.Solid;
const lineWidth = (w) => (isNum(w) ? Math.min(4, Math.max(1, Math.round(w))) : 1);
const toSec = (ms) => Math.floor(ms / 1000);

// lightweight-charts needs time in seconds, strictly ascending and unique.
function cleanCandles(candles) {
  if (!Array.isArray(candles)) return [];
  const byTime = new Map();
  for (const c of candles) {
    if (!c || !isNum(c.time) || !isNum(c.open) || !isNum(c.high) || !isNum(c.low) || !isNum(c.close)) continue;
    byTime.set(toSec(c.time), c); // a later duplicate replaces an earlier one
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, c]) => ({
      time, open: c.open, high: c.high, low: c.low, close: c.close,
      volume: isNum(c.volume) ? c.volume : 0,
    }));
}

function cleanPoints(points) {
  if (!Array.isArray(points)) return [];
  const byTime = new Map();
  for (const p of points) {
    if (!p || !isNum(p.time) || !isNum(p.value)) continue;
    byTime.set(toSec(p.time), p.value);
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time, value }));
}

// Enough decimals to tell one tick from the next on cheap coins.
function priceFormatFor(price) {
  let precision = 2;
  if (isNum(price) && price > 0) {
    if (price < 1) precision = Math.min(10, Math.ceil(-Math.log10(price)) + 3);
    else if (price < 100) precision = 3;
  }
  return { type: 'price', precision, minMove: Number((10 ** -precision).toFixed(precision)) };
}

// Show roughly the last 120 bars (fewer on a narrow screen so they stay
// readable). Returns false when the chart has no width yet and must be framed later.
function frameRecent(chart, el, barCount) {
  if (!chart || !el || barCount === 0) return true;
  if (el.clientWidth < 10) return false;
  const bars = Math.min(VISIBLE_BARS, Math.max(50, Math.floor(el.clientWidth / 5)));
  try {
    chart.timeScale().fitContent();
    if (barCount > bars) {
      chart.timeScale().setVisibleLogicalRange({ from: barCount - bars, to: barCount - 1 + RIGHT_PAD_BARS });
    }
  } catch { /* nothing to lay out yet */ }
  return true;
}

export default function CandleChart({ candles, priceLines, segments, height = 360 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volSeriesRef = useRef(null);
  const priceLineRefs = useRef([]);
  const segmentSeriesRefs = useRef([]);
  const barCountRef = useRef(0);
  const datasetRef = useRef('');
  const needsRangeRef = useRef(false);

  const data = useMemo(() => cleanCandles(candles), [candles]);

  // Overlays are small, so compare them by content: a parent that passes fresh
  // (but identical) arrays on every render does not cause any redrawing.
  const linesKey = JSON.stringify(priceLines ?? NO_LINES);
  const segmentsKey = JSON.stringify(segments ?? NO_LINES);

  const lines = useMemo(() => {
    const raw = JSON.parse(linesKey);
    if (!Array.isArray(raw)) return NO_LINES;
    return raw.filter((l) => l && isNum(l.price));
  }, [linesKey]);

  const segs = useMemo(() => {
    const raw = JSON.parse(segmentsKey);
    if (!Array.isArray(raw)) return NO_LINES;
    return raw
      .map((s) => ({ ...s, points: cleanPoints(s?.points) }))
      .filter((s) => s.points.length >= 2);
  }, [segmentsKey]);

  // Create the chart once per mount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    let chart;
    try {
      chart = createChart(el, {
        layout: {
          background: { type: ColorType.Solid, color: '#0d1117' },
          textColor: '#8b949e',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          fontSize: 11,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: '#1c2128' },
          horzLines: { color: '#1c2128' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: '#484f58', labelBackgroundColor: '#21262d' },
          horzLine: { color: '#484f58', labelBackgroundColor: '#21262d' },
        },
        rightPriceScale: {
          borderColor: '#30363d',
          scaleMargins: { top: 0.05, bottom: 0.22 },
        },
        timeScale: {
          borderColor: '#30363d',
          timeVisible: true,
          secondsVisible: false,
        },
        // The chart sits inside a scrolling page: leave vertical swipes and the
        // mouse wheel to the page. Drag pans, pinch and the axes zoom.
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
        width: el.clientWidth,
        height: el.clientHeight,
      });

      candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: UP,
        downColor: DOWN,
        borderUpColor: UP,
        borderDownColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
      });
      volSeriesRef.current = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    } catch {
      if (chart) { try { chart.remove(); } catch { /* already gone */ } }
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      return undefined;
    }
    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      if (!chartRef.current || el.clientWidth < 10 || el.clientHeight < 10) return;
      chartRef.current.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      if (needsRangeRef.current) needsRangeRef.current = !frameRecent(chartRef.current, el, barCountRef.current);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      try { chart.remove(); } catch { /* already gone */ }
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      priceLineRefs.current = [];
      segmentSeriesRefs.current = [];
      barCountRef.current = 0;
      datasetRef.current = '';
    };
  }, []);

  // Candles + volume.
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volSeries = volSeriesRef.current;
    if (!chart || !candleSeries || !volSeries) return;
    try {
      const interval = data.length > 1 ? data[1].time - data[0].time : 0;
      candleSeries.applyOptions({ priceFormat: priceFormatFor(data[data.length - 1]?.close) });
      chart.applyOptions({ timeScale: { timeVisible: interval > 0 && interval < 86_400 } });
      candleSeries.setData(data.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      volSeries.setData(data.map((c) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? '#3fb95035' : '#f8514935',
      })));
      barCountRef.current = data.length;

      // Re-frame only when a different chart is loaded (another coin or bar
      // size), not when the same chart gains a bar — that keeps the user's zoom.
      const dataset = data.length ? `${data[0].time}:${interval}` : '';
      if (dataset !== datasetRef.current) {
        datasetRef.current = dataset;
        needsRangeRef.current = !frameRecent(chart, containerRef.current, data.length);
      }
    } catch { /* leave the previous drawing in place */ }
  }, [data]);

  // Horizontal price lines.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    for (const pl of priceLineRefs.current) {
      try { series.removePriceLine(pl); } catch { /* already gone */ }
    }
    priceLineRefs.current = [];
    for (const l of lines) {
      try {
        priceLineRefs.current.push(series.createPriceLine({
          price: l.price,
          color: l.color || '#8b949e',
          lineWidth: lineWidth(l.width),
          lineStyle: lineStyle(l.style),
          axisLabelVisible: true,
          title: l.title ? String(l.title) : '',
        }));
      } catch { /* skip a line the library rejects */ }
    }
  }, [lines]);

  // Diagonal segments, each its own line series.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of segmentSeriesRefs.current) {
      try { chart.removeSeries(s); } catch { /* already gone */ }
    }
    segmentSeriesRefs.current = [];
    for (const seg of segs) {
      let series = null;
      try {
        series = chart.addSeries(LineSeries, {
          color: seg.color || '#58a6ff',
          lineWidth: lineWidth(seg.width),
          lineStyle: lineStyle(seg.style),
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          // A long line must not squash the candles: keep it out of auto-scaling.
          autoscaleInfoProvider: () => null,
        });
        series.setData(seg.points);
        segmentSeriesRefs.current.push(series);
      } catch {
        if (series) { try { chart.removeSeries(series); } catch { /* already gone */ } }
      }
    }
  }, [segs]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={containerRef} className="w-full h-full" />
      {data.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0d1117] text-xs text-[#484f58]">
          No chart data
        </div>
      )}
    </div>
  );
}

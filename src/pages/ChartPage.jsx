import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { createChart, ColorType, LineStyle, CrosshairMode } from 'lightweight-charts';
import { COINS } from '../constants';
import { useCoinData } from '../hooks/useCryptoData';
import { calcBollingerBands } from '../utils/indicators';
import TimeframeToggle from '../components/TimeframeToggle';

const TF_INTERVAL = { '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w' };

function formatPrice(p) {
  if (p == null) return '—';
  if (p >= 1000) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(p);
  if (p >= 1)    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(p);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(p);
}

function formatVol(v) {
  if (!v) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

export default function ChartPage() {
  const { symbol } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [timeframe, setTimeframe] = useState(searchParams.get('tf') || '1D');

  const coin = COINS.find(c => c.symbol === symbol);
  const { data, candles, loading } = useCoinData(symbol, timeframe);

  const containerRef = useRef(null);
  const chartRef    = useRef(null);
  const candleRef   = useRef(null);

  const [crosshair, setCrosshair] = useState(null);

  // 24h change from candles
  const change24h = candles && candles.length >= 2
    ? candles[candles.length - 1].close - candles[candles.length - 2].close
    : null;
  const changePct = change24h != null && candles
    ? (change24h / candles[candles.length - 2].close) * 100
    : null;

  const buildChart = useCallback(() => {
    if (!candles?.length || !containerRef.current) return;

    // destroy old
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

    const el = containerRef.current;
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#0d1117' },
        textColor: '#8b949e',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1c2128' },
        horzLines: { color: '#1c2128' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#484f58', width: 1, style: LineStyle.Solid, labelBackgroundColor: '#21262d' },
        horzLine: { color: '#484f58', width: 1, style: LineStyle.Solid, labelBackgroundColor: '#21262d' },
      },
      rightPriceScale: { borderColor: '#30363d', scaleMargins: { top: 0.06, bottom: 0.2 } },
      leftPriceScale:  { visible: false },
      timeScale:       { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
      handleScroll:    { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale:     { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      width:  el.clientWidth,
      height: el.clientHeight,
    });
    chartRef.current = chart;

    // ── Candlesticks ──────────────────────────────────────────
    const candleSeries = chart.addCandlestickSeries({
      upColor:        '#3fb950',
      downColor:      '#f85149',
      borderUpColor:  '#3fb950',
      borderDownColor:'#f85149',
      wickUpColor:    '#3fb950',
      wickDownColor:  '#f85149',
    });
    candleRef.current = candleSeries;

    const cData = candles.map(c => ({
      time:  Math.floor(c.time / 1000),
      open:  c.open, high: c.high, low: c.low, close: c.close,
    }));
    candleSeries.setData(cData);

    // ── Volume ────────────────────────────────────────────────
    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    volSeries.setData(candles.map(c => ({
      time:  Math.floor(c.time / 1000),
      value: c.volume,
      color: c.close >= c.open ? '#3fb95030' : '#f8514930',
    })));

    // ── Bollinger bands ───────────────────────────────────────
    const bbs      = calcBollingerBands(candles, 20, 2);
    const bbOffset = candles.length - bbs.length;

    const makeLine = (color, style = LineStyle.Dashed) => chart.addLineSeries({
      color, lineWidth: 1, lineStyle: style,
      lastValueVisible: false, priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    const bbU = makeLine('#3b4b6b');
    const bbM = makeLine('#484f58', LineStyle.Dotted);
    const bbL = makeLine('#3b4b6b');

    const toTime = i => Math.floor(candles[i + bbOffset].time / 1000);
    bbU.setData(bbs.map((b, i) => ({ time: toTime(i), value: b.upper  })));
    bbM.setData(bbs.map((b, i) => ({ time: toTime(i), value: b.middle })));
    bbL.setData(bbs.map((b, i) => ({ time: toTime(i), value: b.lower  })));

    // ── Crosshair subscription ────────────────────────────────
    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.seriesData) { setCrosshair(null); return; }
      const cd = param.seriesData.get(candleSeries);
      const vd = param.seriesData.get(volSeries);
      if (cd) setCrosshair({ ...cd, volume: vd?.value, time: param.time });
    });

    chart.timeScale().fitContent();

    // Resize
    const ro = new ResizeObserver(() => {
      if (el && chartRef.current) chartRef.current.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [candles]);

  useEffect(() => {
    const cleanup = buildChart();
    return cleanup;
  }, [buildChart]);

  // Escape key → back
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') navigate(`/coin/${symbol}`); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [navigate, symbol]);

  if (!coin) return null;

  const currentPrice = data?.currentPrice ?? candles?.[candles.length - 1]?.close;
  const display = crosshair || null;

  return (
    <div className="flex flex-col h-screen bg-[#0d1117] text-white overflow-hidden">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-[#30363d] px-4 py-2">

        {/* Top row */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Link to={`/coin/${symbol}`}
              className="w-8 h-8 rounded-md flex items-center justify-center text-[#8b949e] hover:text-white hover:bg-[#21262d] transition-colors text-lg font-light">
              ✕
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ backgroundColor: coin.color + '25', color: coin.color }}>
                {coin.symbol.charAt(0)}
              </div>
              <span className="font-semibold">{coin.symbol}</span>
              <span className="text-[#8b949e] text-sm hidden sm:inline">{coin.name}</span>
            </div>
          </div>

          {/* Price + change */}
          <div className="text-right">
            {currentPrice != null && (
              <>
                <div className="font-mono font-bold text-lg tabular-nums">{formatPrice(currentPrice)}</div>
                {changePct != null && (
                  <div className={`text-xs font-mono ${changePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Timeframe row */}
        <div className="flex items-center justify-between">
          <TimeframeToggle value={timeframe} onChange={setTimeframe} />
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#3b4b6b]" /><span className="text-[10px] text-[#484f58]">BB</span>
            <div className="w-2 h-2 rounded-full bg-[#3fb950]/40" /><span className="text-[10px] text-[#484f58]">Vol</span>
          </div>
        </div>
      </div>

      {/* ── OHLCV bar ──────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-[#161b22] border-b border-[#30363d] px-4 py-1.5 flex items-center gap-4 text-xs font-mono overflow-x-auto">
        {display ? (
          <>
            <span className={display.close >= display.open ? 'text-green-400' : 'text-red-400'}>
              {display.close >= display.open ? '▲' : '▼'}
            </span>
            <span className="text-[#8b949e]">O</span><span className="text-white">{formatPrice(display.open)}</span>
            <span className="text-[#8b949e]">H</span><span className="text-green-400">{formatPrice(display.high)}</span>
            <span className="text-[#8b949e]">L</span><span className="text-red-400">{formatPrice(display.low)}</span>
            <span className="text-[#8b949e]">C</span><span className="text-white">{formatPrice(display.close)}</span>
            {display.volume != null && <><span className="text-[#8b949e]">V</span><span className="text-white">{formatVol(display.volume)}</span></>}
          </>
        ) : (
          <>
            {data?.currentPrice != null && <>
              <span className="text-[#8b949e]">Price</span><span className="text-white">{formatPrice(data.currentPrice)}</span>
            </>}
            {data?.atr != null && <>
              <span className="text-[#8b949e]">ATR</span><span className="text-white">{formatPrice(data.atr)}</span>
            </>}
            {data?.rsi != null && <>
              <span className="text-[#8b949e]">RSI</span>
              <span className={data.rsi < 30 ? 'text-green-400' : data.rsi > 70 ? 'text-red-400' : 'text-white'}>
                {data.rsi.toFixed(1)}
              </span>
            </>}
            {data?.bb && <>
              <span className="text-[#8b949e]">BB</span>
              <span className="text-white">{formatPrice(data.bb.lower)} – {formatPrice(data.bb.upper)}</span>
            </>}
            {data?.volume && <>
              <span className="text-[#8b949e]">Vol</span>
              <span className={data.volume.ratio >= 1.2 ? 'text-green-400' : 'text-white'}>
                {data.volume.ratio.toFixed(2)}×
              </span>
            </>}
          </>
        )}
      </div>

      {/* ── Chart ──────────────────────────────────────────── */}
      <div className="flex-1 relative min-h-0">
        {loading && !candles && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="w-6 h-6 border-2 border-[#30363d] border-t-[#58a6ff] rounded-full animate-spin" />
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>

      {/* ── Bottom info strip ───────────────────────────────── */}
      {data && (
        <div className="flex-shrink-0 border-t border-[#30363d] bg-[#161b22] px-4 py-2 grid grid-cols-4 gap-2 text-center">
          {[
            { label: 'Volatility', value: data.volatility.toUpperCase(), color: data.volatility === 'low' ? 'text-green-400' : data.volatility === 'high' ? 'text-red-400' : 'text-yellow-400' },
            { label: 'MACD', value: data.macd?.status ? data.macd.status.charAt(0).toUpperCase() + data.macd.status.slice(1) : '—', color: data.macd?.status === 'bullish' ? 'text-green-400' : data.macd?.status === 'bearish' ? 'text-red-400' : 'text-yellow-400' },
            { label: 'BB Width', value: data.bb ? `${data.bb.bbw.toFixed(1)}%` : '—', color: 'text-white' },
            { label: 'Entry', value: data.entrySignal ? '● Signal' : `${data.activeConditions}/5`, color: data.entrySignal ? 'text-green-400' : 'text-[#8b949e]' },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <div className="text-[9px] text-[#484f58] uppercase tracking-wider">{label}</div>
              <div className={`text-xs font-semibold mt-0.5 ${color}`}>{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  createChart, ColorType, LineStyle, CrosshairMode,
  CandlestickSeries, HistogramSeries, LineSeries,
} from 'lightweight-charts';
import { findCoin } from '../constants';
import { useCoinData } from '../hooks/useCryptoData';
import { calcBollingerBands } from '../utils/indicators';
import TimeframeToggle from '../components/TimeframeToggle';

function fmtPrice(p) {
  if (p == null) return '—';
  if (p >= 1000) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(p);
  if (p >= 1)    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(p);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(p);
}
function fmtVol(v) {
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

  const coin = findCoin(symbol);
  const { data, candles, loading } = useCoinData(symbol, timeframe);

  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const [crosshair, setCrosshair] = useState(null);
  const [chartErr, setChartErr]   = useState(null);

  // Block body scroll while this page is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Escape → back
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') navigate(`/coin/${symbol}`); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [navigate, symbol]);

  // Build / rebuild chart whenever candles arrive
  useEffect(() => {
    if (!candles?.length || !containerRef.current) return;

    if (chartRef.current) {
      try { chartRef.current.remove(); } catch (_) {}
      chartRef.current = null;
    }
    setChartErr(null);

    const el = containerRef.current;
    if (el.clientHeight < 10) return;

    let chart;
    try {
      chart = createChart(el, {
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
        width:  el.clientWidth,
        height: el.clientHeight,
      });

      chartRef.current = chart;

      // ── Candlesticks (v5 API) ─────────────────────────────────────
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor:         '#3fb950',
        downColor:       '#f85149',
        borderUpColor:   '#3fb950',
        borderDownColor: '#f85149',
        wickUpColor:     '#3fb950',
        wickDownColor:   '#f85149',
      });
      candleSeries.setData(candles.map(c => ({
        time: Math.floor(c.time / 1000),
        open: c.open, high: c.high, low: c.low, close: c.close,
      })));

      // ── Volume bars (v5 API) ──────────────────────────────────────
      const volSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
      });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volSeries.setData(candles.map(c => ({
        time:  Math.floor(c.time / 1000),
        value: c.volume,
        color: c.close >= c.open ? '#3fb95035' : '#f8514935',
      })));

      // ── Bollinger Bands (v5 API) ──────────────────────────────────
      try {
        const bbs      = calcBollingerBands(candles, 20, 2);
        const bbOffset = candles.length - bbs.length;
        const lineOpts = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };

        const bbU = chart.addSeries(LineSeries, { ...lineOpts, color: '#3b4b6b', lineWidth: 1, lineStyle: LineStyle.Dashed });
        const bbM = chart.addSeries(LineSeries, { ...lineOpts, color: '#484f58', lineWidth: 1, lineStyle: LineStyle.Dotted });
        const bbL = chart.addSeries(LineSeries, { ...lineOpts, color: '#3b4b6b', lineWidth: 1, lineStyle: LineStyle.Dashed });

        bbU.setData(bbs.map((b, i) => ({ time: Math.floor(candles[i + bbOffset].time / 1000), value: b.upper })));
        bbM.setData(bbs.map((b, i) => ({ time: Math.floor(candles[i + bbOffset].time / 1000), value: b.middle })));
        bbL.setData(bbs.map((b, i) => ({ time: Math.floor(candles[i + bbOffset].time / 1000), value: b.lower })));
      } catch (_) { /* BB calc failed silently */ }

      // ── Crosshair → OHLCV bar ─────────────────────────────────────
      chart.subscribeCrosshairMove(param => {
        if (!param?.time) { setCrosshair(null); return; }
        const cd = param.seriesData?.get(candleSeries);
        const vd = param.seriesData?.get(volSeries);
        if (cd) setCrosshair({ ...cd, volume: vd?.value });
      });

      chart.timeScale().fitContent();

    } catch (err) {
      setChartErr('Chart failed to load. Tap Back to return.');
      if (chart) { try { chart.remove(); } catch (_) {} }
      chartRef.current = null;
      return;
    }

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (chartRef.current && el.clientHeight > 10) {
        chartRef.current.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      try { chartRef.current?.remove(); } catch (_) {}
      chartRef.current = null;
    };
  }, [candles]);

  if (!coin) {
    return (
      <div className="fixed inset-0 bg-[#0d1117] flex flex-col items-center justify-center gap-4">
        <p className="text-[#8b949e]">Unknown coin</p>
        <Link to="/" className="text-[#58a6ff] text-sm">← Back to dashboard</Link>
      </div>
    );
  }

  const currentPrice = data?.currentPrice ?? candles?.[candles.length - 1]?.close;
  const prevClose    = candles?.length >= 2 ? candles[candles.length - 2].close : null;
  const change       = currentPrice != null && prevClose ? currentPrice - prevClose : null;
  const changePct    = change != null && prevClose ? (change / prevClose) * 100 : null;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column' }}
      className="bg-[#0d1117] text-white">

      {/* ── HEADER ────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-[#30363d] px-4 pt-12 pb-2 sm:pt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/coin/${symbol}`)}
              className="w-9 h-9 rounded-xl flex items-center justify-center bg-[#21262d] text-white text-xl font-light active:bg-[#30363d]">
              ✕
            </button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: coin.color + '25', color: coin.color }}>
                {coin.symbol.charAt(0)}
              </div>
              <div>
                <div className="font-semibold text-sm leading-tight">{coin.symbol}</div>
                <div className="text-[#8b949e] text-[10px]">{coin.name}</div>
              </div>
            </div>
          </div>

          <div className="text-right">
            {currentPrice != null && (
              <>
                <div className="font-mono font-bold text-base tabular-nums">{fmtPrice(currentPrice)}</div>
                {changePct != null && (
                  <div className={`text-xs font-mono ${changePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <TimeframeToggle value={timeframe} onChange={setTimeframe} />
      </div>

      {/* ── OHLCV BAR ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-[#161b22] border-b border-[#30363d] px-3 py-1.5 flex items-center gap-3 text-xs font-mono overflow-x-auto">
        {crosshair ? (
          <>
            <span className={crosshair.close >= crosshair.open ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
              {crosshair.close >= crosshair.open ? '▲' : '▼'}
            </span>
            <span className="text-[#484f58]">O</span><span>{fmtPrice(crosshair.open)}</span>
            <span className="text-[#484f58]">H</span><span className="text-green-400">{fmtPrice(crosshair.high)}</span>
            <span className="text-[#484f58]">L</span><span className="text-red-400">{fmtPrice(crosshair.low)}</span>
            <span className="text-[#484f58]">C</span><span>{fmtPrice(crosshair.close)}</span>
            {crosshair.volume != null && <><span className="text-[#484f58]">V</span><span>{fmtVol(crosshair.volume)}</span></>}
          </>
        ) : (
          <span className="text-[#484f58] text-[10px]">Drag finger across chart to see O / H / L / C / Volume</span>
        )}
      </div>

      {/* ── CHART ─────────────────────────────────────────────── */}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        {(loading && !candles) && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-[#0d1117]">
            <div className="w-8 h-8 border-2 border-[#30363d] border-t-[#58a6ff] rounded-full animate-spin" />
          </div>
        )}
        {chartErr && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 bg-[#0d1117]">
            <p className="text-red-400 text-sm">{chartErr}</p>
            <button onClick={() => navigate(`/coin/${symbol}`)}
              className="px-4 py-2 rounded-lg bg-[#21262d] text-white text-sm">
              ← Back
            </button>
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* ── BOTTOM STRIP ──────────────────────────────────────── */}
      {data && (
        <div className="flex-shrink-0 border-t border-[#30363d] bg-[#161b22] px-4 py-2 grid grid-cols-4 gap-1 text-center">
          {[
            { label: 'Volatility', value: data.volatility ? data.volatility.toUpperCase() : '—', color: data.volatility === 'low' ? 'text-green-400' : data.volatility === 'high' ? 'text-red-400' : 'text-yellow-400' },
            { label: 'RSI', value: data.rsi != null ? data.rsi.toFixed(1) : '—', color: data.rsi != null && data.rsi < 30 ? 'text-green-400' : data.rsi != null && data.rsi > 70 ? 'text-red-400' : 'text-white' },
            { label: 'MACD', value: data.macd?.status ? data.macd.status.charAt(0).toUpperCase() + data.macd.status.slice(1) : '—', color: data.macd?.status === 'bullish' ? 'text-green-400' : data.macd?.status === 'bearish' ? 'text-red-400' : 'text-yellow-400' },
            { label: 'Entry', value: data.entrySignal ? '● Active' : `${data.activeConditions ?? 0}/5`, color: data.entrySignal ? 'text-green-400' : 'text-[#8b949e]' },
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

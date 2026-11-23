import { findCoin } from '../../constants';

export function fmtUsd(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

export function fmtPrice(p) {
  if (p == null || Number.isNaN(p)) return '—';
  const d = p >= 1000 ? 0 : p >= 1 ? 2 : p >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d }).format(p);
}

export function fmtPct(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

export function timeAgo(t, now = Date.now()) {
  if (!t) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function fmtDate(t) {
  return t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
}

export function coinMeta(sym) {
  return findCoin(sym) ?? { symbol: sym, name: sym, color: '#8b949e' };
}

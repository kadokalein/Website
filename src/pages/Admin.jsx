import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import { supabase, isSupabaseConfigured, ADMIN_EMAIL } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

// ─── demo data shown when Supabase is not yet configured ────────────────────
const DEMO_SUBSCRIBERS = [
  { country: 'United States', status: 'active', created_at: '2025-01-15' },
  { country: 'United States', status: 'active', created_at: '2025-01-22' },
  { country: 'United Kingdom', status: 'active', created_at: '2025-02-01' },
  { country: 'Canada', status: 'active', created_at: '2025-02-10' },
  { country: 'Germany', status: 'active', created_at: '2025-02-18' },
  { country: 'Australia', status: 'active', created_at: '2025-03-05' },
  { country: 'United States', status: 'active', created_at: '2025-03-12' },
  { country: 'France', status: 'active', created_at: '2025-03-20' },
  { country: 'Japan', status: 'active', created_at: '2025-04-01' },
  { country: 'Canada', status: 'active', created_at: '2025-04-08' },
  { country: 'United Kingdom', status: 'active', created_at: '2025-04-15' },
  { country: 'Brazil', status: 'canceled', created_at: '2025-04-22' },
  { country: 'India', status: 'active', created_at: '2025-05-01' },
  { country: 'Netherlands', status: 'active', created_at: '2025-05-10' },
  { country: 'United States', status: 'active', created_at: '2025-05-18' },
];
const DEMO_PAYMENTS = Array.from({ length: 6 }, (_, i) => {
  const d = new Date(2025, i, 1);
  return { amount: (3 + i) * 2000, paid_at: d.toISOString(), month: d.toLocaleString('en-US', { month: 'short' }) };
});

function buildStats(subscribers, payments) {
  const active = subscribers.filter(s => s.status === 'active').length;
  const totalRevenue = payments.reduce((s, p) => s + p.amount, 0) / 100;
  const mrr = active * 20;

  // Country breakdown
  const byCountry = {};
  subscribers.forEach(s => { byCountry[s.country] = (byCountry[s.country] || 0) + 1; });
  const topCountries = Object.entries(byCountry)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Monthly revenue chart
  const byMonth = {};
  payments.forEach(p => {
    const m = new Date(p.paid_at).toLocaleString('en-US', { month: 'short', year: '2-digit' });
    byMonth[m] = (byMonth[m] || 0) + p.amount / 100;
  });
  const revenueChart = Object.entries(byMonth)
    .sort((a, b) => new Date('01 ' + a[0]) - new Date('01 ' + b[0]))
    .map(([month, revenue]) => ({ month, revenue }));

  return { active, totalRevenue, mrr, topCountries, revenueChart };
}

const COUNTRY_COLORS = ['#58a6ff','#3fb950','#f78166','#bc8cff','#ffa657','#79c0ff','#56d364','#ff7b72','#d2a8ff','#ffb77b'];

const StatCard = ({ label, value, sub, color = 'text-white' }) => (
  <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
    <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-2">{label}</div>
    <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
    {sub && <div className="text-xs text-[#8b949e] mt-1">{sub}</div>}
  </div>
);

function AdminContent({ subscribers, payments }) {
  const { active, totalRevenue, mrr, topCountries, revenueChart } = buildStats(subscribers, payments);
  const trend = revenueChart.length >= 2
    ? revenueChart[revenueChart.length - 1].revenue - revenueChart[revenueChart.length - 2].revenue
    : 0;

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Active Subscribers" value={active.toLocaleString()} color="text-[#58a6ff]" />
        <StatCard label="Monthly Revenue" value={`$${mrr.toLocaleString()}`} color="text-green-400"
          sub={trend !== 0 ? `${trend >= 0 ? '▲' : '▼'} $${Math.abs(trend).toFixed(0)} vs last month` : undefined} />
        <StatCard label="Total Revenue" value={`$${totalRevenue.toLocaleString()}`} color="text-[#bc8cff]" />
        <StatCard label="Total Members" value={subscribers.length.toLocaleString()}
          sub={`${subscribers.filter(s => s.status === 'canceled').length} canceled`} />
      </div>

      {/* Revenue trend chart */}
      <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-4">Monthly Revenue</div>
        {revenueChart.length > 0
          ? <ResponsiveContainer width="100%" height={200}>
              <LineChart data={revenueChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 8" stroke="#21262d" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#484f58' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#484f58' }} tickFormatter={v => `$${v}`} axisLine={false} tickLine={false} width={44} />
                <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8 }}
                  labelStyle={{ color: '#8b949e', fontSize: 11 }} itemStyle={{ color: '#3fb950', fontSize: 12 }}
                  formatter={v => [`$${v}`, 'Revenue']} />
                <Line type="monotone" dataKey="revenue" stroke="#3fb950" strokeWidth={2.5} dot={{ r: 3, fill: '#3fb950' }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          : <div className="h-[200px] flex items-center justify-center text-[#484f58] text-sm">No payment data yet</div>
        }
      </div>

      {/* Top 10 countries */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
          <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-4">Top 10 Countries</div>
          {topCountries.length > 0
            ? <ResponsiveContainer width="100%" height={220}>
                <BarChart data={topCountries} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#484f58' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#8b949e' }} axisLine={false} tickLine={false} width={90} />
                  <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8 }}
                    labelStyle={{ color: '#8b949e', fontSize: 11 }} itemStyle={{ fontSize: 12 }}
                    formatter={v => [v, 'Subscribers']} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {topCountries.map((_, i) => <Cell key={i} fill={COUNTRY_COLORS[i % COUNTRY_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            : <div className="h-[220px] flex items-center justify-center text-[#484f58] text-sm">No subscribers yet</div>
          }
        </div>

        {/* Country table */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
          <div className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest mb-4">Country Breakdown</div>
          <div className="space-y-1.5">
            {topCountries.map((c, i) => (
              <div key={c.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-[#484f58] font-mono w-4 text-xs">{i + 1}</span>
                  <span className="text-[#8b949e]">{c.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-20 h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(c.count / topCountries[0].count) * 100}%`, background: COUNTRY_COLORS[i % COUNTRY_COLORS.length] }} />
                  </div>
                  <span className="font-mono text-white text-xs w-6 text-right">{c.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  const { user, loading } = useAuth();
  const [data, setData] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginErr, setLoginErr] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const isAdmin = user?.email === ADMIN_EMAIL;
  const isDemo = !isSupabaseConfigured;

  useEffect(() => {
    if (!isAdmin) return;
    if (isDemo) { setData({ subscribers: DEMO_SUBSCRIBERS, payments: DEMO_PAYMENTS }); return; }
    setFetching(true);
    Promise.all([
      supabase.from('subscribers').select('*'),
      supabase.from('payments').select('*').order('paid_at'),
    ]).then(([s, p]) => {
      setData({ subscribers: s.data || [], payments: p.data || [] });
      setFetching(false);
    });
  }, [isAdmin, isDemo]);

  async function handleAdminLogin(e) {
    e.preventDefault();
    setLoginErr('');
    setLoginBusy(true);
    if (!isSupabaseConfigured) {
      // Demo: allow any credentials for local preview
      setLoginErr('Supabase not configured — showing demo data.');
      setLoginBusy(false);
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: loginForm.email, password: loginForm.password });
    setLoginBusy(false);
    if (error) { setLoginErr(error.message); return; }
    if (loginForm.email !== ADMIN_EMAIL) setLoginErr('Access denied: not an admin account.');
  }

  async function handleSignOut() {
    if (supabase) await supabase.auth.signOut();
  }

  if (loading) return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-[#30363d] border-t-[#58a6ff] rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <header className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117]/95 backdrop-blur px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/Website/logo.svg" alt="" className="w-6 h-6 rounded-full" />
            <Link to="/" className="text-[#8b949e] hover:text-white text-sm">← Dashboard</Link>
            <span className="text-[#30363d]">|</span>
            <span className="text-white font-semibold text-sm">Admin</span>
            {isDemo && <span className="text-[10px] bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 rounded px-1.5 py-0.5">Demo data</span>}
          </div>
          {isAdmin && <button onClick={handleSignOut} className="text-xs text-[#8b949e] hover:text-white">Sign out</button>}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {!isAdmin ? (
          /* Admin login */
          <div className="max-w-sm mx-auto">
            <div className="text-center mb-8">
              <div className="text-white font-semibold text-xl mb-1">Admin Access</div>
              <div className="text-[#8b949e] text-sm">Sign in with your admin account</div>
            </div>
            <form onSubmit={handleAdminLogin} className="rounded-xl border border-[#30363d] bg-[#161b22] p-6 space-y-3">
              <input
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-white placeholder-[#484f58] text-sm focus:outline-none focus:border-[#58a6ff]"
                type="email" placeholder="Admin email" value={loginForm.email}
                onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))} />
              <input
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-white placeholder-[#484f58] text-sm focus:outline-none focus:border-[#58a6ff]"
                type="password" placeholder="Password" value={loginForm.password}
                onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))} />
              {loginErr && <p className="text-red-400 text-xs">{loginErr}</p>}
              <button type="submit" disabled={loginBusy}
                className="w-full py-3 rounded-lg bg-[#6e40c9] hover:bg-[#7d4fd4] text-white font-semibold text-sm transition-colors disabled:opacity-50">
                {loginBusy ? 'Signing in…' : 'Sign in to Admin'}
              </button>
            </form>
          </div>
        ) : fetching ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-6 h-6 border-2 border-[#30363d] border-t-[#58a6ff] rounded-full animate-spin" />
          </div>
        ) : data ? (
          <AdminContent subscribers={data.subscribers} payments={data.payments} />
        ) : null}
      </main>
    </div>
  );
}

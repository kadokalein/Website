import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured, STRIPE_PAYMENT_LINK, ADMIN_EMAIL } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

const COUNTRIES = [
  'United States','United Kingdom','Canada','Australia','Germany','France','Japan',
  'South Korea','India','Brazil','Mexico','Netherlands','Spain','Italy','Sweden',
  'Norway','Denmark','Switzerland','Singapore','New Zealand','Argentina','Chile',
  'Colombia','South Africa','Nigeria','Kenya','Ghana','Egypt','UAE','Saudi Arabia',
  'Philippines','Indonesia','Malaysia','Thailand','Vietnam','Pakistan','Bangladesh',
  'Russia','Poland','Ukraine','Czech Republic','Romania','Hungary','Portugal',
  'Greece','Turkey','Israel','China','Taiwan','Hong Kong','Other',
];

const INPUT = 'w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-white placeholder-[#484f58] text-sm focus:outline-none focus:border-[#58a6ff] transition-colors';
const BTN_PRIMARY = 'w-full py-3 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_SOCIAL = 'w-full py-2.5 rounded-lg border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-white text-sm font-medium transition-colors flex items-center justify-center gap-2.5';

export default function Subscribe() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('signup'); // signup | signin | payment | success
  const [form, setForm] = useState({ name: '', email: '', password: '', country: '' });
  const [card, setCard] = useState({ number: '', expiry: '', cvv: '', nameOnCard: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [subStatus, setSubStatus] = useState(null);

  // After Stripe redirect with ?payment_success=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    if (params.get('payment_success') === '1' && user) {
      activateSubscription(user);
    }
  }, [user]);

  // Load existing subscription status
  useEffect(() => {
    if (!user || !supabase) return;
    supabase.from('subscribers').select('status,created_at').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => {
        if (data) { setSubStatus(data); setMode('success'); }
      });
  }, [user]);

  async function activateSubscription(u) {
    if (!supabase) return;
    const meta = u.user_metadata ?? {};
    await supabase.from('subscribers').upsert({
      user_id: u.id,
      name: meta.name || form.name || u.email?.split('@')[0],
      email: u.email,
      country: meta.country || form.country || 'Unknown',
      status: 'active',
    });
    // Record first payment
    await supabase.from('payments').insert({ user_id: u.id, amount: 2000 });
    setMode('success');
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setErr(''); }
  function setC(k, v) { setCard(c => ({ ...c, [k]: v })); setErr(''); }

  function fmtCardNumber(v) {
    return v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
  }
  function fmtExpiry(v) {
    const d = v.replace(/\D/g, '').slice(0, 4);
    return d.length >= 3 ? `${d.slice(0,2)}/${d.slice(2)}` : d;
  }

  async function handleSignUp(e) {
    e.preventDefault();
    if (!isSupabaseConfigured) { setErr('Auth not configured — see setup instructions.'); return; }
    if (!form.name || !form.email || !form.password || !form.country) { setErr('All fields are required.'); return; }
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signUp({
      email: form.email, password: form.password,
      options: { data: { name: form.name, country: form.country } },
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setMode('payment');
  }

  async function handleSignIn(e) {
    e.preventDefault();
    if (!isSupabaseConfigured) { setErr('Auth not configured — see setup instructions.'); return; }
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    // onAuthStateChange will update user; useEffect will check subscription
  }

  async function handleOAuth(provider) {
    if (!isSupabaseConfigured) { setErr('Auth not configured.'); return; }
    const redirect = `${window.location.origin}${window.location.pathname}#/subscribe`;
    await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: redirect } });
  }

  async function handlePayment(e) {
    e.preventDefault();
    if (!user) return;
    setBusy(true); setErr('');

    // Validate card fields (real Stripe would handle validation)
    const rawNum = card.number.replace(/\s/g, '');
    if (rawNum.length < 16) { setBusy(false); setErr('Enter a valid 16-digit card number.'); return; }
    if (!card.expiry.match(/^\d{2}\/\d{2}$/)) { setBusy(false); setErr('Enter expiry as MM/YY.'); return; }
    if (card.cvv.length < 3) { setBusy(false); setErr('Enter a valid CVV.'); return; }

    // If Stripe Payment Link is configured, redirect there
    if (STRIPE_PAYMENT_LINK) {
      const link = `${STRIPE_PAYMENT_LINK}?client_reference_id=${user.id}&prefilled_email=${encodeURIComponent(user.email)}&success_url=${encodeURIComponent(window.location.href + '?payment_success=1')}`;
      window.location.href = link;
      return;
    }

    // Demo mode: record subscription without real payment
    await activateSubscription(user);
    setBusy(false);
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
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/Website/logo.svg" alt="" className="w-6 h-6 rounded-full" />
            <Link to="/" className="text-[#8b949e] hover:text-white text-sm">← Dashboard</Link>
          </div>
          {user && (
            <button onClick={handleSignOut} className="text-xs text-[#8b949e] hover:text-white">
              Sign out
            </button>
          )}
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-12">

        {/* Pricing hero */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-[#1f2937] border border-[#30363d] rounded-full px-3 py-1 text-xs text-[#58a6ff] mb-4">
            Promethea Programs
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">$20 / month</h1>
          <p className="text-[#8b949e] text-sm">Full access to Crypto Volatility &amp; Entry Tracker</p>
          <ul className="mt-4 space-y-1.5 text-sm text-[#8b949e] text-left max-w-xs mx-auto">
            {['Live price data refreshed every 5 seconds','ATR, RSI, MACD, Bollinger Band analysis','Trade calculator with sell targets','Coin detail pages with price charts','Cancel any time'].map(f => (
              <li key={f} className="flex items-center gap-2"><span className="text-green-400">✓</span>{f}</li>
            ))}
          </ul>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-6">

          {/* ── Success state ── */}
          {mode === 'success' && (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center mx-auto text-2xl">✓</div>
              <div>
                <div className="text-white font-semibold text-lg">You're subscribed!</div>
                <div className="text-[#8b949e] text-sm mt-1">Thanks for subscribing, {user?.user_metadata?.name || user?.email}.</div>
              </div>
              {subStatus?.created_at && (
                <div className="text-xs text-[#484f58]">
                  Member since {new Date(subStatus.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </div>
              )}
              <Link to="/" className="inline-block mt-2 px-5 py-2 rounded-lg bg-[#21262d] border border-[#30363d] text-sm text-white hover:bg-[#30363d] transition-colors">
                Go to Dashboard
              </Link>
            </div>
          )}

          {/* ── Payment form ── */}
          {mode === 'payment' && (
            <form onSubmit={handlePayment} className="space-y-4">
              <div className="text-center mb-2">
                <div className="text-white font-semibold">Complete your subscription</div>
                <div className="text-[#8b949e] text-xs mt-1">Billed $20.00 monthly · Cancel any time</div>
              </div>

              {/* Apple Pay button */}
              <button type="button"
                onClick={() => setErr('Apple Pay requires Stripe to be configured. See setup guide.')}
                className="w-full py-3 rounded-lg bg-white text-black font-semibold text-sm flex items-center justify-center gap-2 hover:bg-gray-100 transition-colors">
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                Pay with Apple Pay
              </button>

              <div className="flex items-center gap-2 text-[#484f58] text-xs">
                <div className="flex-1 h-px bg-[#30363d]" /><span>or pay with card</span><div className="flex-1 h-px bg-[#30363d]" />
              </div>

              <div>
                <label className="text-xs text-[#8b949e] mb-1 block">Name on card</label>
                <input className={INPUT} placeholder="Jane Doe" value={card.nameOnCard} onChange={e => setC('nameOnCard', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-[#8b949e] mb-1 block">Card number</label>
                <input className={INPUT} placeholder="1234 5678 9012 3456" inputMode="numeric"
                  value={card.number} onChange={e => setC('number', fmtCardNumber(e.target.value))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#8b949e] mb-1 block">Expiry</label>
                  <input className={INPUT} placeholder="MM/YY" inputMode="numeric"
                    value={card.expiry} onChange={e => setC('expiry', fmtExpiry(e.target.value))} />
                </div>
                <div>
                  <label className="text-xs text-[#8b949e] mb-1 block">CVV</label>
                  <input className={INPUT} placeholder="123" inputMode="numeric" maxLength={4}
                    value={card.cvv} onChange={e => setC('cvv', e.target.value.replace(/\D/g, '').slice(0,4))} />
                </div>
              </div>

              {err && <p className="text-red-400 text-xs">{err}</p>}

              {!isSupabaseConfigured && (
                <p className="text-yellow-400 text-xs bg-yellow-400/10 rounded p-2">
                  Demo mode: Supabase + Stripe not configured. Payment will be simulated.
                </p>
              )}

              <button type="submit" disabled={busy} className={BTN_PRIMARY}>
                {busy ? 'Processing…' : 'Subscribe — $20 / month'}
              </button>
              <p className="text-center text-[10px] text-[#484f58]">
                Secured by Stripe · Cancel anytime in your account
              </p>
            </form>
          )}

          {/* ── Sign up form ── */}
          {mode === 'signup' && !user && (
            <form onSubmit={handleSignUp} className="space-y-3">
              <div className="text-center mb-2">
                <div className="text-white font-semibold">Create your account</div>
                <div className="text-[#8b949e] text-xs mt-1">Already have one?{' '}
                  <button type="button" onClick={() => setMode('signin')} className="text-[#58a6ff] hover:underline">Sign in</button>
                </div>
              </div>

              {/* Social auth */}
              <button type="button" onClick={() => handleOAuth('google')} className={BTN_SOCIAL}>
                <svg viewBox="0 0 24 24" className="w-4 h-4"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Continue with Google
              </button>
              <button type="button" onClick={() => handleOAuth('apple')} className={BTN_SOCIAL}>
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                Continue with Apple
              </button>

              <div className="flex items-center gap-2 text-[#484f58] text-xs">
                <div className="flex-1 h-px bg-[#30363d]" /><span>or sign up with email</span><div className="flex-1 h-px bg-[#30363d]" />
              </div>

              <input className={INPUT} placeholder="Full name" value={form.name} onChange={e => set('name', e.target.value)} />
              <input className={INPUT} type="email" placeholder="Email address" value={form.email} onChange={e => set('email', e.target.value)} />
              <input className={INPUT} type="password" placeholder="Password (min 8 characters)" minLength={8} value={form.password} onChange={e => set('password', e.target.value)} />
              <select className={INPUT} value={form.country} onChange={e => set('country', e.target.value)}>
                <option value="">Select country…</option>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>

              {err && <p className="text-red-400 text-xs">{err}</p>}
              <button type="submit" disabled={busy} className={BTN_PRIMARY}>
                {busy ? 'Creating account…' : 'Create account & continue'}
              </button>
            </form>
          )}

          {/* ── Sign in form ── */}
          {mode === 'signin' && !user && (
            <form onSubmit={handleSignIn} className="space-y-3">
              <div className="text-center mb-2">
                <div className="text-white font-semibold">Welcome back</div>
                <div className="text-[#8b949e] text-xs mt-1">New here?{' '}
                  <button type="button" onClick={() => setMode('signup')} className="text-[#58a6ff] hover:underline">Create account</button>
                </div>
              </div>
              <button type="button" onClick={() => handleOAuth('google')} className={BTN_SOCIAL}>
                <svg viewBox="0 0 24 24" className="w-4 h-4"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Continue with Google
              </button>
              <input className={INPUT} type="email" placeholder="Email address" value={form.email} onChange={e => set('email', e.target.value)} />
              <input className={INPUT} type="password" placeholder="Password" value={form.password} onChange={e => set('password', e.target.value)} />
              {err && <p className="text-red-400 text-xs">{err}</p>}
              <button type="submit" disabled={busy} className={BTN_PRIMARY}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {/* ── Logged in but not subscribed ── */}
          {user && mode !== 'payment' && mode !== 'success' && (
            <div className="text-center space-y-4">
              <div className="text-white">Signed in as <span className="text-[#58a6ff]">{user.email}</span></div>
              {user.email === ADMIN_EMAIL
                ? <Link to="/admin" className="block w-full py-3 rounded-lg bg-[#6e40c9] hover:bg-[#7d4fd4] text-white font-semibold text-sm text-center transition-colors">
                    Go to Admin Dashboard
                  </Link>
                : <button onClick={() => setMode('payment')} className={BTN_PRIMARY}>
                    Subscribe — $20 / month
                  </button>
              }
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

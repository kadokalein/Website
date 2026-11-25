import { createClient } from '@supabase/supabase-js';

// The project URL and publishable key are meant to be public (they ship in every
// Supabase web app); the database's row-level security rules protect the data.
// Build-time variables override these, e.g. to point a test build elsewhere.
const DEFAULT_URL = 'https://mbxuttajnjgjakuzcton.supabase.co';
const DEFAULT_KEY = 'sb_publishable_rxj7UUzt4nprQF3C6DAzBQ_qT71pQ4Y';

const url = import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_KEY;

export const supabase = url && key ? createClient(url, key) : null;
export const isSupabaseConfigured = Boolean(url && key);

export const ADMIN_EMAIL = 'sk.8trboi247@live.com';
export const ADMIN_USERNAME = 'Admin';

// Login forms accept the username "Admin" as well as the admin email.
export function loginEmail(input) {
  const v = String(input ?? '').trim();
  return v.toLowerCase() === ADMIN_USERNAME.toLowerCase() ? ADMIN_EMAIL : v;
}

export const STRIPE_PAYMENT_LINK = import.meta.env.VITE_STRIPE_PAYMENT_LINK || '';
export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

const WatchlistContext = createContext({
  symbols: [], loading: false,
  toggle: () => {}, isWatching: () => false,
});

const lsKey = uid => `pp_watchlist_${uid}`;

export function WatchlistProvider({ children }) {
  const { user } = useAuth();
  const [symbols, setSymbols] = useState([]);
  const [loading, setLoading] = useState(false);

  // Load on user change
  useEffect(() => {
    if (!user) { setSymbols([]); return; }
    setLoading(true);

    if (!supabase) {
      const stored = JSON.parse(localStorage.getItem(lsKey(user.id)) ?? '[]');
      setSymbols(stored);
      setLoading(false);
      return;
    }

    supabase
      .from('watchlist')
      .select('symbol')
      .eq('user_id', user.id)
      .order('added_at', { ascending: false })
      .then(({ data }) => {
        setSymbols(data?.map(r => r.symbol) ?? []);
        setLoading(false);
      });
  }, [user]);

  const add = useCallback(async symbol => {
    if (!user || symbols.includes(symbol)) return;
    const next = [symbol, ...symbols];
    setSymbols(next);
    if (!supabase) { localStorage.setItem(lsKey(user.id), JSON.stringify(next)); return; }
    await supabase.from('watchlist').insert({ user_id: user.id, symbol });
  }, [user, symbols]);

  const remove = useCallback(async symbol => {
    if (!user) return;
    const next = symbols.filter(s => s !== symbol);
    setSymbols(next);
    if (!supabase) { localStorage.setItem(lsKey(user.id), JSON.stringify(next)); return; }
    await supabase.from('watchlist').delete().eq('user_id', user.id).eq('symbol', symbol);
  }, [user, symbols]);

  const toggle = useCallback(symbol =>
    symbols.includes(symbol) ? remove(symbol) : add(symbol),
    [symbols, add, remove]);

  const isWatching = useCallback(symbol => symbols.includes(symbol), [symbols]);

  return (
    <WatchlistContext.Provider value={{ symbols, loading, toggle, isWatching }}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  return useContext(WatchlistContext);
}

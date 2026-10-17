import { useAuth } from '../hooks/useAuth';
import { useWatchlist } from '../context/WatchlistContext';

export default function WatchButton({ symbol, className = '' }) {
  const { user } = useAuth();
  const { isWatching, toggle } = useWatchlist();
  const watching = isWatching(symbol);

  function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      window.location.hash = '#/subscribe?mode=signin';
      return;
    }
    toggle(symbol);
  }

  return (
    <button
      onClick={handleClick}
      title={watching ? 'Remove from watchlist' : 'Add to watchlist'}
      className={`w-7 h-7 rounded-full flex items-center justify-center text-base transition-all ${
        watching
          ? 'text-yellow-300 bg-yellow-400/15 hover:bg-red-400/20 hover:text-red-400'
          : 'text-[#484f58] hover:text-yellow-300 hover:bg-yellow-400/10'
      } ${className}`}
    >
      {watching ? '★' : '☆'}
    </button>
  );
}

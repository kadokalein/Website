import { HashRouter, Routes, Route } from 'react-router-dom';
import { WatchlistProvider } from './context/WatchlistContext';
import Dashboard from './pages/Dashboard';
import CoinDetail from './pages/CoinDetail';
import Calculator from './pages/Calculator';
import Subscribe from './pages/Subscribe';
import Admin from './pages/Admin';
import ChartPage from './pages/ChartPage';
import Watchlist from './pages/Watchlist';
import PaperTrading from './pages/PaperTrading';
import LiveTrading from './pages/LiveTrading';

export default function App() {
  return (
    <HashRouter>
      <WatchlistProvider>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/coin/:symbol" element={<CoinDetail />} />
          <Route path="/coin/:symbol/chart" element={<ChartPage />} />
          <Route path="/calculator" element={<Calculator />} />
          <Route path="/calculator/:symbol" element={<Calculator />} />
          <Route path="/subscribe" element={<Subscribe />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/paper" element={<PaperTrading />} />
          <Route path="/live" element={<LiveTrading />} />
        </Routes>
      </WatchlistProvider>
    </HashRouter>
  );
}

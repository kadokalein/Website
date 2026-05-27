import { HashRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import CoinDetail from './pages/CoinDetail';
import Calculator from './pages/Calculator';
import Subscribe from './pages/Subscribe';
import Admin from './pages/Admin';
import ChartPage from './pages/ChartPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/coin/:symbol" element={<CoinDetail />} />
        <Route path="/coin/:symbol/chart" element={<ChartPage />} />
        <Route path="/calculator" element={<Calculator />} />
        <Route path="/calculator/:symbol" element={<Calculator />} />
        <Route path="/subscribe" element={<Subscribe />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </HashRouter>
  );
}

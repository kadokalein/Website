import { HashRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import CoinDetail from './pages/CoinDetail';
import Calculator from './pages/Calculator';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/coin/:symbol" element={<CoinDetail />} />
        <Route path="/calculator" element={<Calculator />} />
        <Route path="/calculator/:symbol" element={<Calculator />} />
      </Routes>
    </HashRouter>
  );
}

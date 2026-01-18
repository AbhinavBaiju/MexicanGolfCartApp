import { AppProvider as PolarisProvider, Frame } from '@shopify/polaris';
import { NavMenu } from '@shopify/app-bridge-react';
import enTranslations from '@shopify/polaris/locales/en.json';
import { BrowserRouter, Routes, Route } from 'react-router-dom';


// Pages
import Dashboard from './pages/Dashboard';
import Bookings from './pages/Bookings';
import Inventory from './pages/Inventory';
import Locations from './pages/Locations';

function AppContent() {
  return (
    <Frame>
      <NavMenu>
        <a href="/" rel="home">Dashboard</a>
        <a href="/bookings">Bookings</a>
        <a href="/inventory">Inventory</a>
        <a href="/locations">Locations</a>
      </NavMenu>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/bookings" element={<Bookings />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/locations" element={<Locations />} />
      </Routes>
    </Frame>
  );
}

function App() {
  const apiKey = import.meta.env.VITE_SHOPIFY_API_KEY;

  if (!apiKey) {
    return <div>Missing API Key</div>;
  }

  return (
    <PolarisProvider i18n={enTranslations}>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </PolarisProvider>
  );
}

export default App;

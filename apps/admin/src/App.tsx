import { AppProvider as PolarisProvider, Frame, Navigation } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';


// Pages
import Dashboard from './pages/Dashboard';
import Bookings from './pages/Bookings';
import Inventory from './pages/Inventory';
import Products from './pages/Products';
import Locations from './pages/Locations';

function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();

  const navigationMarkup = (
    <Navigation location={location.pathname}>
      <Navigation.Section
        items={[
          {
            url: '/',
            label: 'Dashboard',
            onClick: () => navigate('/'),
            selected: location.pathname === '/',
          },
          {
            url: '/bookings',
            label: 'Bookings',
            onClick: () => navigate('/bookings'),
            selected: location.pathname === '/bookings',
          },
          {
            url: '/inventory',
            label: 'Inventory',
            onClick: () => navigate('/inventory'),
            selected: location.pathname === '/inventory',
          },
          {
            url: '/products',
            label: 'Products',
            onClick: () => navigate('/products'),
            selected: location.pathname === '/products',
          },
          {
            url: '/locations',
            label: 'Locations',
            onClick: () => navigate('/locations'),
            selected: location.pathname === '/locations',
          },
        ]}
      />
    </Navigation>
  );

  return (
    <Frame navigation={navigationMarkup}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/bookings" element={<Bookings />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/products" element={<Products />} />
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


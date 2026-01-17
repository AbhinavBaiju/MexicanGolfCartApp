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
  const appSearch = location.search;

  const appUrl = (path: string) => `${path}${appSearch}`;
  const handleNavigate = (path: string) => navigate(appUrl(path));

  const navigationMarkup = (
    <Navigation location={location.pathname}>
      <Navigation.Section
        items={[
          {
            url: appUrl('/'),
            label: 'Dashboard',
            onClick: () => handleNavigate('/'),
            selected: location.pathname === '/',
          },
          {
            url: appUrl('/bookings'),
            label: 'Bookings',
            onClick: () => handleNavigate('/bookings'),
            selected: location.pathname === '/bookings',
          },
          {
            url: appUrl('/inventory'),
            label: 'Inventory',
            onClick: () => handleNavigate('/inventory'),
            selected: location.pathname === '/inventory',
          },
          {
            url: appUrl('/products'),
            label: 'Products',
            onClick: () => handleNavigate('/products'),
            selected: location.pathname === '/products',
          },
          {
            url: appUrl('/locations'),
            label: 'Locations',
            onClick: () => handleNavigate('/locations'),
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

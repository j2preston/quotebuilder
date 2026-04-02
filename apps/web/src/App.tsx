import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth.ts';
import Layout from './components/layout/Layout.tsx';
import LoginPage from './pages/LoginPage.tsx';
import RegisterPage from './pages/RegisterPage.tsx';
import DashboardPage from './pages/DashboardPage.tsx';
import QuotesPage from './pages/QuotesPage.tsx';
import QuoteDetailPage from './pages/QuoteDetailPage.tsx';
import NewQuotePage from './pages/NewQuotePage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuthStore();
  if (!accessToken) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="quotes" element={<QuotesPage />} />
        <Route path="quotes/new" element={<NewQuotePage />} />
        <Route path="quotes/:id" element={<QuoteDetailPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

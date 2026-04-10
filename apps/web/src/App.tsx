import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth.ts';
import Layout from './components/layout/Layout.tsx';
import LoginPage from './pages/LoginPage.tsx';
import RegisterPage from './pages/RegisterPage.tsx';
import DashboardPage from './pages/DashboardPage.tsx';
import QuotesPage from './pages/QuotesPage.tsx';
import QuoteDetailPage from './pages/QuoteDetailPage.tsx';
import DitatePage from './pages/DitatePage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import OnboardingPage from './pages/OnboardingPage.tsx';

// Auth-only guard — used for onboarding (doesn't redirect to /onboarding)
function RequireAuthOnly({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuthStore();
  if (!accessToken) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { accessToken, trader } = useAuthStore();
  if (!accessToken) return <Navigate to="/login" replace />;
  if (trader && !trader.onboardingComplete) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login"    element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/onboarding" element={<RequireAuthOnly><OnboardingPage /></RequireAuthOnly>} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index              element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"   element={<DashboardPage />} />
        <Route path="quotes"      element={<QuotesPage />} />
        <Route path="quotes/:id"  element={<QuoteDetailPage />} />
        <Route path="dictate"     element={<DitatePage />} />
        <Route path="settings"    element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

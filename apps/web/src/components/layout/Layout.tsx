import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FileText, PlusCircle, Settings, LogOut, Zap } from 'lucide-react';
import { useAuthStore } from '../../store/auth.ts';
import { cn } from '../../lib/utils.ts';
import { api } from '../../lib/api.ts';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/quotes', icon: FileText, label: 'Quotes' },
  { to: '/quotes/new', icon: PlusCircle, label: 'New Quote' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Layout() {
  const { trader, logout, refreshToken } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout', { refreshToken });
    } catch {
      // ignore
    }
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-60 bg-white border-r border-gray-200 px-4 py-6">
        <div className="flex items-center gap-2 mb-8 px-2">
          <Zap className="h-6 w-6 text-brand-700" />
          <span className="font-bold text-lg text-brand-700">QuoteBot</span>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-gray-200 pt-4 mt-4">
          <p className="text-xs text-gray-500 px-3 mb-1">{trader?.businessName}</p>
          <p className="text-xs text-gray-400 px-3 mb-3 capitalize">
            {trader?.subscriptionTier} plan
          </p>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 w-full"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-h-screen">
        <main className="flex-1 p-4 md:p-8 max-w-6xl mx-auto w-full">
          <Outlet />
        </main>

        {/* Bottom nav — mobile */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 flex">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex-1 flex flex-col items-center py-3 text-xs',
                  isActive ? 'text-brand-700' : 'text-gray-500'
                )
              }
            >
              <Icon className="h-5 w-5 mb-0.5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

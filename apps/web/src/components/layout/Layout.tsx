import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FileText, Mic, Settings, LogOut, Zap } from 'lucide-react';
import { useAuthStore } from '../../store/auth.ts';
import { cn } from '../../lib/utils.ts';
import { api } from '../../lib/api.ts';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/quotes',    icon: FileText,         label: 'Quotes' },
  { to: '/dictate',   icon: Mic,              label: 'Dictate', highlight: true },
  { to: '/settings',  icon: Settings,         label: 'Settings' },
];

export default function Layout() {
  const { trader, logout, refreshToken } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try { await api.post('/auth/logout', { refreshToken }); } catch { /* ignore */ }
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-60 bg-brand-700 px-4 py-6">
        <div className="flex items-center gap-2 mb-8 px-2">
          <Zap className="h-6 w-6 text-white" />
          <span className="font-bold text-lg text-white">QuoteBot</span>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map(({ to, icon: Icon, label, highlight }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  highlight && !isActive
                    ? 'bg-brand-500 text-white hover:bg-brand-400'
                    : isActive
                    ? 'bg-white/20 text-white'
                    : 'text-brand-100 hover:bg-white/10 hover:text-white',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/20 pt-4 mt-4">
          <p className="text-xs text-brand-200 px-3 mb-1 truncate">{trader?.businessName}</p>
          <p className="text-xs text-brand-300 px-3 mb-3 capitalize">{trader?.plan ?? 'trial'} plan</p>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-brand-100 hover:bg-white/10 hover:text-white w-full"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-h-screen">
        <main className="flex-1 p-4 md:p-8 max-w-3xl mx-auto w-full pb-20 md:pb-8">
          <Outlet />
        </main>

        {/* Bottom nav — mobile */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 flex safe-area-inset-bottom">
          {navItems.map(({ to, icon: Icon, label, highlight }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex-1 flex flex-col items-center py-2 text-xs gap-0.5',
                  highlight
                    ? isActive ? 'text-brand-700' : 'text-brand-600'
                    : isActive ? 'text-brand-700' : 'text-gray-500',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <div className={cn(
                    'p-1 rounded-full transition-colors',
                    highlight && !isActive ? 'bg-brand-700 text-white p-2' : '',
                  )}>
                    <Icon className={highlight && !isActive ? 'h-5 w-5' : 'h-5 w-5'} />
                  </div>
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

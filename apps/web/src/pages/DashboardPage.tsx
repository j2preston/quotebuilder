import { Link } from 'react-router-dom';
import { PlusCircle, FileText, CheckCircle, Clock, TrendingUp } from 'lucide-react';
import { useQuotes } from '../hooks/useQuotes.ts';
import { useAuthStore } from '../store/auth.ts';
import { formatGBP } from '@quotebot/shared';
import { STATUS_LABELS, STATUS_COLORS } from '../lib/utils.ts';
import type { Quote } from '@quotebot/shared';

export default function DashboardPage() {
  const { trader } = useAuthStore();
  const { data, isLoading } = useQuotes();

  const quotes = data?.data ?? [];

  const stats = {
    total: quotes.length,
    accepted: quotes.filter((q) => q.status === 'accepted').length,
    pending: quotes.filter((q) => ['pending_review', 'ready', 'sent', 'viewed'].includes(q.status)).length,
    revenue: quotes.filter((q) => q.status === 'accepted').reduce((s, q) => s + q.totalGrossPence, 0),
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">Welcome back, {trader?.fullName?.split(' ')[0]}</p>
        </div>
        <Link to="/quotes/new" className="btn-primary">
          <PlusCircle className="h-4 w-4" />
          New Quote
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={FileText} label="Total Quotes" value={String(stats.total)} color="blue" />
        <StatCard icon={CheckCircle} label="Accepted" value={String(stats.accepted)} color="green" />
        <StatCard icon={Clock} label="In Progress" value={String(stats.pending)} color="yellow" />
        <StatCard icon={TrendingUp} label="Revenue" value={formatGBP(stats.revenue)} color="purple" />
      </div>

      {/* Quota */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Monthly quota</span>
          <span className="text-xs text-gray-500 capitalize">{trader?.subscriptionTier} plan</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-600 rounded-full transition-all"
            style={{
              width: `${Math.min(100, ((trader?.quotesUsedThisMonth ?? 0) / 30) * 100)}%`,
            }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {trader?.quotesUsedThisMonth ?? 0} quotes used this month
        </p>
      </div>

      {/* Recent quotes */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Recent Quotes</h2>
          <Link to="/quotes" className="text-xs text-brand-700 hover:underline">View all</Link>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : quotes.length === 0 ? (
          <div className="card p-8 text-center">
            <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No quotes yet.</p>
            <Link to="/quotes/new" className="btn-primary mt-4 inline-flex">
              Create your first quote
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {quotes.slice(0, 5).map((quote) => (
              <QuoteRow key={quote.id} quote={quote} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string;
  color: 'blue' | 'green' | 'yellow' | 'purple';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    yellow: 'bg-yellow-50 text-yellow-700',
    purple: 'bg-purple-50 text-purple-700',
  };
  return (
    <div className="card p-4">
      <div className={`inline-flex p-2 rounded-lg ${colors[color]} mb-3`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

function QuoteRow({ quote }: { quote: Quote }) {
  return (
    <Link to={`/quotes/${quote.id}`} className="card p-4 flex items-center justify-between hover:border-brand-200 transition-colors">
      <div>
        <p className="text-sm font-medium text-gray-900">{quote.quoteNumber}</p>
        <p className="text-xs text-gray-500 mt-0.5">{quote.customer?.name ?? 'No customer'} · {quote.jobType.replace(/_/g, ' ')}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-gray-900">{formatGBP(quote.totalGrossPence)}</p>
        <span className={`badge ${STATUS_COLORS[quote.status]} mt-1`}>
          {STATUS_LABELS[quote.status]}
        </span>
      </div>
    </Link>
  );
}

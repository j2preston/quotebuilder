import { Link } from 'react-router-dom';
import { FileText, CheckCircle, Clock, TrendingUp, Mic } from 'lucide-react';
import { useQuotes } from '../hooks/useQuotes.ts';
import { useAuthStore } from '../store/auth.ts';
import { formatGBP } from '@quotebot/shared';
import { STATUS_LABELS, STATUS_COLORS } from '../lib/utils.ts';
import type { Quote } from '@quotebot/shared';

export default function DashboardPage() {
  const { trader } = useAuthStore();
  const { data, isLoading } = useQuotes();

  const quotes = data?.quotes ?? [];

  const thisMonth = new Date();
  thisMonth.setDate(1); thisMonth.setHours(0, 0, 0, 0);

  const monthQuotes  = quotes.filter((q) => new Date(q.createdAt) >= thisMonth);
  const totalValue   = quotes.filter((q) => q.status === 'accepted').reduce((s, q) => s + q.total, 0);
  const pendingCount = quotes.filter((q) => q.status === 'sent').length;

  const quotaLimit   = trader?.plan === 'pro' ? Infinity : trader?.plan === 'starter' ? 30 : 3;
  const used         = trader?.quotesUsedThisMonth ?? 0;
  const quotaPct     = quotaLimit === Infinity ? 0 : Math.min(100, (used / quotaLimit) * 100);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Hey {trader?.name?.split(' ')[0] ?? 'there'} 👋
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Here's your quoting overview</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          icon={FileText}
          label="This month"
          value={String(monthQuotes.length)}
          sub={`of ${quotaLimit === Infinity ? '∞' : quotaLimit}`}
          color="blue"
        />
        <StatCard
          icon={TrendingUp}
          label="Accepted revenue"
          value={formatGBP(totalValue)}
          color="green"
        />
        <StatCard
          icon={Clock}
          label="Awaiting reply"
          value={String(pendingCount)}
          color="yellow"
        />
      </div>

      {/* Dictate CTA */}
      <Link
        to="/dictate"
        className="flex items-center gap-4 p-5 rounded-2xl bg-brand-700 text-white shadow-lg hover:bg-brand-600 transition-colors active:scale-98"
      >
        <div className="bg-white/20 rounded-full p-3">
          <Mic className="h-7 w-7" />
        </div>
        <div>
          <p className="font-bold text-lg leading-tight">🎤 Dictate a Quote</p>
          <p className="text-sm text-brand-200 mt-0.5">Speak the job — we'll price it in seconds</p>
        </div>
      </Link>

      {/* Secondary actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/quotes" className="card p-4 flex items-center gap-3 hover:border-brand-200 transition-colors">
          <FileText className="h-5 w-5 text-brand-500" />
          <span className="text-sm font-medium">📋 All Quotes</span>
        </Link>
        <Link to="/settings" className="card p-4 flex items-center gap-3 hover:border-brand-200 transition-colors">
          <CheckCircle className="h-5 w-5 text-gray-400" />
          <span className="text-sm font-medium">⚙️ Settings</span>
        </Link>
      </div>

      {/* Quota bar */}
      {quotaLimit !== Infinity && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Monthly quota</span>
            <span className="text-xs text-gray-500 capitalize">{trader?.plan ?? 'trial'} plan</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${quotaPct >= 90 ? 'bg-red-500' : quotaPct >= 70 ? 'bg-yellow-400' : 'bg-brand-600'}`}
              style={{ width: `${quotaPct}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">{used} / {quotaLimit} quotes used</p>
        </div>
      )}

      {/* Recent quotes */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Recent Quotes</h2>
          <Link to="/quotes" className="text-xs text-brand-700 hover:underline">View all</Link>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card p-4 animate-pulse h-[60px]" />
            ))}
          </div>
        ) : quotes.length === 0 ? (
          <div className="card p-8 text-center">
            <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No quotes yet.</p>
            <Link to="/dictate" className="btn-primary mt-4 inline-flex">
              🎤 Create your first quote
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {quotes.slice(0, 5).map((q) => <QuoteRow key={q.id} quote={q} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  color: 'blue' | 'green' | 'yellow';
}) {
  const bg = { blue: 'bg-blue-50 text-blue-700', green: 'bg-green-50 text-green-700', yellow: 'bg-yellow-50 text-yellow-700' }[color];
  return (
    <div className="card p-3 flex flex-col gap-2">
      <div className={`inline-flex p-1.5 rounded-lg w-fit ${bg}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div>
        <p className="text-lg font-bold text-gray-900 leading-none">{value}</p>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function QuoteRow({ quote }: { quote: Quote }) {
  const age = Math.floor((Date.now() - new Date(quote.createdAt).getTime()) / 86400000);
  return (
    <Link
      to={`/quotes/${quote.id}`}
      className="card p-3.5 flex items-center justify-between hover:border-brand-200 transition-colors"
    >
      <div className="min-w-0 mr-3">
        <p className="text-sm font-medium text-gray-900 truncate">
          {quote.customerName || 'No customer'}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          {age === 0 ? 'Today' : age === 1 ? 'Yesterday' : `${age}d ago`}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-gray-900">{formatGBP(quote.total)}</p>
        <span className={`badge ${STATUS_COLORS[quote.status]} mt-1`}>
          {STATUS_LABELS[quote.status]}
        </span>
      </div>
    </Link>
  );
}

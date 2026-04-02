import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle, Search, FileText } from 'lucide-react';
import { useQuotes } from '../hooks/useQuotes.ts';
import { formatGBP } from '@quotebot/shared';
import { STATUS_LABELS, STATUS_COLORS } from '../lib/utils.ts';
import type { QuoteStatus } from '@quotebot/shared';

const STATUS_FILTERS: Array<{ label: string; value: QuoteStatus | '' }> = [
  { label: 'All', value: '' },
  { label: 'Needs Review', value: 'pending_review' },
  { label: 'Ready', value: 'ready' },
  { label: 'Sent', value: 'sent' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'Draft', value: 'draft' },
];

export default function QuotesPage() {
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | ''>('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuotes(statusFilter || undefined);
  const quotes = (data?.data ?? []).filter((q) =>
    !search ||
    q.quoteNumber.toLowerCase().includes(search.toLowerCase()) ||
    q.customer?.name?.toLowerCase().includes(search.toLowerCase()) ||
    q.jobDescription.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Quotes</h1>
        <Link to="/quotes/new" className="btn-primary">
          <PlusCircle className="h-4 w-4" />
          New Quote
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          className="input pl-9"
          placeholder="Search quotes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Status filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              statusFilter === f.value
                ? 'bg-brand-700 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-brand-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card p-4 animate-pulse h-16" />
          ))}
        </div>
      ) : quotes.length === 0 ? (
        <div className="card p-10 text-center">
          <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No quotes found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {quotes.map((quote) => (
            <Link
              key={quote.id}
              to={`/quotes/${quote.id}`}
              className="card p-4 flex items-center justify-between hover:border-brand-200 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-900">{quote.quoteNumber}</p>
                  <span className={`badge ${STATUS_COLORS[quote.status]}`}>
                    {STATUS_LABELS[quote.status]}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {quote.customer?.name ?? 'No customer'} · {quote.jobType.replace(/_/g, ' ')}
                </p>
              </div>
              <div className="ml-4 text-right shrink-0">
                <p className="text-sm font-bold text-gray-900">{formatGBP(quote.totalGrossPence)}</p>
                <p className="text-xs text-gray-400">
                  {new Date(quote.createdAt).toLocaleDateString('en-GB')}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

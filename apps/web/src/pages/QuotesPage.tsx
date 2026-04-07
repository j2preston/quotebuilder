import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Mic, FileText, RefreshCw } from 'lucide-react';
import { useQuotesInfinite } from '../hooks/useQuotes.ts';
import { formatGBP } from '@quotebot/shared';
import { STATUS_LABELS, STATUS_COLORS } from '../lib/utils.ts';
import type { Quote, QuoteStatus } from '@quotebot/shared';

const STATUS_FILTERS: Array<{ label: string; value: QuoteStatus | '' }> = [
  { label: 'All',      value: '' },
  { label: 'Draft',    value: 'draft' },
  { label: 'Sent',     value: 'sent' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'Declined', value: 'declined' },
  { label: 'Expired',  value: 'expired' },
];

export default function QuotesPage() {
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | ''>('');
  const loaderRef = useRef<HTMLDivElement>(null);

  const {
    data, isLoading, isFetchingNextPage, hasNextPage,
    fetchNextPage, refetch, isRefetching,
  } = useQuotesInfinite(statusFilter || undefined);

  const quotes = data?.pages.flatMap((p) => p.quotes) ?? [];

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (!loaderRef.current || !hasNextPage) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage(); },
      { rootMargin: '200px' },
    );
    obs.observe(loaderRef.current);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Quotes</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="btn-secondary p-2"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
          </button>
          <Link to="/dictate" className="btn-primary">
            <Mic className="h-4 w-4" />
            New
          </Link>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={`
              shrink-0 px-4 py-2 rounded-full text-xs font-medium transition-colors min-h-touch
              ${statusFilter === f.value
                ? 'bg-brand-700 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-brand-300'}
            `}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card p-4 animate-pulse h-[72px]" />
          ))}
        </div>
      ) : quotes.length === 0 ? (
        <div className="card p-10 text-center mt-4">
          <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No quotes found</p>
          <Link to="/dictate" className="btn-primary mt-4 inline-flex">
            🎤 Dictate your first quote
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {quotes.map((quote) => <QuoteCard key={quote.id} quote={quote} />)}
          </div>

          {/* Infinite scroll trigger */}
          <div ref={loaderRef} className="py-4 text-center">
            {isFetchingNextPage && (
              <div className="inline-block h-5 w-5 border-2 border-brand-700 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function QuoteCard({ quote }: { quote: Quote }) {
  const age = Math.floor((Date.now() - new Date(quote.createdAt).getTime()) / 86400000);
  const ageLabel = age === 0 ? 'Today' : age === 1 ? 'Yesterday' : `${age}d ago`;

  return (
    <Link
      to={`/quotes/${quote.id}`}
      className="card p-4 flex items-center justify-between hover:border-brand-200 transition-colors active:bg-gray-50"
    >
      <div className="min-w-0 mr-3">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {quote.customerName || 'No customer'}
          </p>
          <span className={`badge ${STATUS_COLORS[quote.status]}`}>
            {STATUS_LABELS[quote.status]}
          </span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5 truncate">
          {ageLabel}
          {quote.notes ? ` · ${quote.notes.slice(0, 50)}` : ''}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-gray-900">{formatGBP(quote.total)}</p>
      </div>
    </Link>
  );
}

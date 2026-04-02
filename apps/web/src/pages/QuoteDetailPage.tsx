import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Edit2, FileDown, Send, Trash2, CheckCircle, XCircle, ExternalLink, Plus, Minus } from 'lucide-react';
import { useQuote, useUpdateQuote, useDeleteQuote, useGeneratePdf } from '../hooks/useQuotes.ts';
import { formatGBP, JOB_TYPE_LABELS } from '@quotebot/shared';
import { STATUS_LABELS, STATUS_COLORS } from '../lib/utils.ts';
import type { QuoteLineItem } from '@quotebot/shared';

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: quote, isLoading } = useQuote(id!);
  const updateQuote = useUpdateQuote();
  const deleteQuote = useDeleteQuote();
  const generatePdf = useGeneratePdf();

  const [editingItems, setEditingItems] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        <div className="card h-40" />
        <div className="card h-60" />
      </div>
    );
  }

  if (!quote) return <p className="text-gray-500">Quote not found.</p>;

  const canEdit = ['draft', 'pending_review', 'ready'].includes(quote.status);
  const canSend = quote.status === 'ready';
  const canMarkReady = quote.status === 'pending_review';

  const handleDelete = async () => {
    if (!confirm('Delete this quote?')) return;
    await deleteQuote.mutateAsync(id!);
    navigate('/quotes');
  };

  const handleMarkReady = () => updateQuote.mutate({ id: id!, status: 'ready' });
  const handleMarkAccepted = () => updateQuote.mutate({ id: id!, status: 'accepted' });
  const handleMarkDeclined = () => updateQuote.mutate({ id: id!, status: 'declined' });

  return (
    <div className="space-y-4 pb-24 md:pb-0 max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">{quote.quoteNumber}</h1>
            <span className={`badge ${STATUS_COLORS[quote.status]}`}>
              {STATUS_LABELS[quote.status]}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {JOB_TYPE_LABELS[quote.jobType] ?? quote.jobType}
            {quote.validUntil && ` · Valid until ${new Date(quote.validUntil).toLocaleDateString('en-GB')}`}
          </p>
        </div>
        <button onClick={handleDelete} className="btn-secondary text-red-500 hover:text-red-600 shrink-0">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* AI Clarifications */}
      {quote.aiExtractedData?.clarificationNeeded && quote.aiExtractedData.clarificationNeeded.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-yellow-800 mb-1">Things to check</p>
          <ul className="list-disc list-inside space-y-0.5">
            {quote.aiExtractedData.clarificationNeeded.map((q, i) => (
              <li key={i} className="text-sm text-yellow-700">{q}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Job details */}
      <div className="card p-4 space-y-3">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Customer</p>
          <p className="text-sm font-medium">{quote.customer?.name ?? '—'}</p>
          {quote.customer?.email && <p className="text-sm text-gray-500">{quote.customer.email}</p>}
          {quote.customer?.phone && <p className="text-sm text-gray-500">{quote.customer.phone}</p>}
        </div>
        {quote.jobAddress && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Job Address</p>
            <p className="text-sm">{quote.jobAddress}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Description</p>
          <p className="text-sm">{quote.jobDescription}</p>
        </div>
      </div>

      {/* Line items */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">Line Items</p>
          {canEdit && (
            <button
              onClick={() => setEditingItems(!editingItems)}
              className="text-xs text-brand-700 flex items-center gap-1"
            >
              <Edit2 className="h-3 w-3" />
              {editingItems ? 'Done' : 'Edit'}
            </button>
          )}
        </div>

        {quote.lineItems.length === 0 ? (
          <p className="text-sm text-gray-400 px-4 py-6 text-center">No line items yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Description</th>
                <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quote.lineItems.map((item) => (
                <LineItemRow key={item.id} item={item} />
              ))}
            </tbody>
          </table>
        )}

        {/* Totals */}
        <div className="border-t border-gray-100 px-4 py-3 space-y-1">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Subtotal (ex VAT)</span>
            <span>{formatGBP(quote.subtotalNetPence)}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-600">
            <span>VAT ({quote.vatPct}%)</span>
            <span>{formatGBP(quote.vatAmountPence)}</span>
          </div>
          <div className="flex justify-between font-bold text-base">
            <span>Total</span>
            <span>{formatGBP(quote.totalGrossPence)}</span>
          </div>
        </div>
      </div>

      {/* Internal notes */}
      {quote.internalNotes && (
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Internal Notes</p>
          <p className="text-sm text-gray-700">{quote.internalNotes}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {canMarkReady && (
          <button onClick={handleMarkReady} disabled={updateQuote.isPending} className="btn-primary">
            <CheckCircle className="h-4 w-4" />
            Mark Ready to Send
          </button>
        )}

        {canSend && (
          <button
            onClick={() => generatePdf.mutate(id!, { onSuccess: (d) => window.open(d.pdfUrl) })}
            disabled={generatePdf.isPending}
            className="btn-primary"
          >
            <FileDown className="h-4 w-4" />
            {generatePdf.isPending ? 'Generating…' : 'Generate PDF'}
          </button>
        )}

        {quote.pdfUrl && (
          <a href={quote.pdfUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">
            <ExternalLink className="h-4 w-4" />
            View PDF
          </a>
        )}

        {quote.status === 'sent' && (
          <>
            <button onClick={handleMarkAccepted} className="btn-primary">
              <CheckCircle className="h-4 w-4" />
              Mark Accepted
            </button>
            <button onClick={handleMarkDeclined} className="btn-secondary text-red-500">
              <XCircle className="h-4 w-4" />
              Mark Declined
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function LineItemRow({ item }: { item: QuoteLineItem }) {
  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="px-4 py-2.5">
        <p className="text-gray-900">{item.description}</p>
        <p className="text-xs text-gray-400">
          {item.quantity} {item.unit}
          {item.labourMinutes > 0 && ` · ${item.labourMinutes}min labour`}
        </p>
      </td>
      <td className="px-4 py-2.5 text-right font-medium">
        {formatGBP(item.lineNetPence)}
      </td>
    </tr>
  );
}

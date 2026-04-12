import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FileDown, Send, Trash2, CheckCircle, XCircle,
  ExternalLink, Plus, Pencil, X, Check, TrendingUp,
} from 'lucide-react';
import {
  useQuote, useUpdateQuote, useUpdateLineItems,
  useDeleteQuote, useGeneratePdf, useSendQuote, useLogCorrection,
} from '../hooks/useQuotes.ts';
import type { CorrectionResult } from '../hooks/useQuotes.ts';
import { formatGBP } from '@quotebot/shared';
import { STATUS_LABELS, STATUS_COLORS } from '../lib/utils.ts';
import type { QuoteLineItem } from '@quotebot/shared';

// ─── Calibration reasons ──────────────────────────────────────────────────────

const CORRECTION_REASONS = [
  { value: 'took_longer',    label: '⏱ Took longer than expected' },
  { value: 'old_property',   label: '🏚 Old / complex property' },
  { value: 'standard_rate',  label: '💷 My standard rate differs' },
  { value: 'other',          label: '✏️ Other' },
] as const;

// ─── Inline editable field ────────────────────────────────────────────────────

function InlineText({
  value, onSave, placeholder, className = '',
}: { value: string; onSave: (v: string) => void; placeholder?: string; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);

  const commit = () => { onSave(draft); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
          className={`input py-1 text-sm ${className}`}
        />
        <button onClick={commit} className="p-1 text-green-600"><Check className="h-4 w-4" /></button>
        <button onClick={cancel} className="p-1 text-gray-400"><X className="h-4 w-4" /></button>
      </div>
    );
  }
  return (
    <button
      onClick={() => { setDraft(value); setEditing(true); }}
      className={`text-left hover:underline decoration-dashed decoration-gray-300 underline-offset-2 ${className}`}
    >
      {value || <span className="text-gray-400 italic">{placeholder}</span>}
      <Pencil className="inline ml-1.5 h-3 w-3 text-gray-300" />
    </button>
  );
}

// ─── Line item row ────────────────────────────────────────────────────────────

interface LineItemRowProps {
  item: QuoteLineItem;
  canEdit: boolean;
  jobKey?: string;
  quoteId: string;
  onUpdate: (updated: Partial<QuoteLineItem>) => void;
  onDelete: () => void;
}

function LineItemRow({ item, canEdit, jobKey, quoteId, onUpdate, onDelete }: LineItemRowProps) {
  const [editingQty,   setEditingQty]   = useState(false);
  const [editingPrice, setEditingPrice] = useState(false);
  const [qtyDraft,     setQtyDraft]     = useState(String(item.qty));
  const [priceDraft,   setPriceDraft]   = useState(String(item.unitPrice));

  // Calibration prompt state
  const [showCalib,    setShowCalib]    = useState(false);
  const [calibReason,  setCalibReason]  = useState('');
  const [pendingQty,   setPendingQty]   = useState<number | null>(null);
  const [calibResult,  setCalibResult]  = useState<CorrectionResult | null>(null);
  const logCorrection = useLogCorrection();

  const commitQty = () => {
    const next = parseFloat(qtyDraft);
    if (isNaN(next) || next <= 0) { setQtyDraft(String(item.qty)); setEditingQty(false); return; }
    if (next !== item.qty) {
      // Labour hour change — show calibration prompt
      setPendingQty(next);
      setShowCalib(true);
    } else {
      onUpdate({ qty: next });
    }
    setEditingQty(false);
  };

  const commitPrice = () => {
    const next = parseFloat(priceDraft);
    if (isNaN(next) || next < 0) { setPriceDraft(String(item.unitPrice)); setEditingPrice(false); return; }
    onUpdate({ unitPrice: next });
    setEditingPrice(false);
  };

  const submitCalibration = () => {
    if (pendingQty === null) return;
    onUpdate({ qty: pendingQty });
    logCorrection.mutate(
      { quoteId, jobKey: jobKey ?? 'unknown', field: 'labour_hours', oldValue: item.qty, newValue: pendingQty, reason: calibReason },
      {
        onSuccess: (result) => {
          setCalibResult(result);
          setShowCalib(false);
          setPendingQty(null);
          setCalibReason('');
        },
      },
    );
  };

  return (
    <>
      <tr className="border-b border-gray-50 last:border-0">
        <td className="px-4 py-2.5 min-w-0">
          {canEdit ? (
            <InlineText
              value={item.description}
              onSave={(v) => onUpdate({ description: v })}
              placeholder="Description"
              className="w-full font-normal text-gray-900"
            />
          ) : (
            <span className="text-sm text-gray-900">{item.description}</span>
          )}
        </td>
        <td className="px-2 py-2.5 text-center whitespace-nowrap">
          {canEdit && editingQty ? (
            <input
              autoFocus
              type="number"
              value={qtyDraft}
              onChange={(e) => setQtyDraft(e.target.value)}
              onBlur={commitQty}
              onKeyDown={(e) => { if (e.key === 'Enter') commitQty(); if (e.key === 'Escape') { setQtyDraft(String(item.qty)); setEditingQty(false); } }}
              className="input w-16 py-1 text-sm text-center"
              min={0.01} step={0.01}
            />
          ) : (
            <button
              onClick={() => canEdit && setEditingQty(true)}
              className={`text-sm text-gray-700 ${canEdit ? 'hover:underline decoration-dashed' : ''}`}
            >
              {item.qty}
            </button>
          )}
        </td>
        <td className="px-2 py-2.5 text-right whitespace-nowrap">
          {canEdit && editingPrice ? (
            <input
              autoFocus
              type="number"
              value={priceDraft}
              onChange={(e) => setPriceDraft(e.target.value)}
              onBlur={commitPrice}
              onKeyDown={(e) => { if (e.key === 'Enter') commitPrice(); if (e.key === 'Escape') { setPriceDraft(String(item.unitPrice)); setEditingPrice(false); } }}
              className="input w-20 py-1 text-sm text-right"
              min={0} step={0.01}
            />
          ) : (
            <button
              onClick={() => canEdit && setEditingPrice(true)}
              className={`text-sm text-gray-700 ${canEdit ? 'hover:underline decoration-dashed' : ''}`}
            >
              {formatGBP(item.unitPrice)}
            </button>
          )}
        </td>
        <td className="px-4 py-2.5 text-right whitespace-nowrap">
          <span className="text-sm font-medium">{formatGBP(item.total)}</span>
        </td>
        {canEdit && (
          <td className="px-2 py-2.5">
            <button onClick={onDelete} className="p-1 text-gray-300 hover:text-red-400">
              <X className="h-4 w-4" />
            </button>
          </td>
        )}
      </tr>

      {/* Calibration prompt */}
      {showCalib && (
        <tr>
          <td colSpan={5} className="px-4 py-3 bg-amber-50">
            <p className="text-xs font-semibold text-amber-800 mb-2">
              Why are you changing the hours?
            </p>
            <div className="flex flex-wrap gap-2 mb-2">
              {CORRECTION_REASONS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setCalibReason(r.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    calibReason === r.value
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-white text-amber-700 border-amber-300 hover:border-amber-500'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={submitCalibration}
                disabled={!calibReason || logCorrection.isPending}
                className="btn-primary text-xs py-1.5 px-3"
              >
                {logCorrection.isPending ? 'Saving…' : 'Confirm change'}
              </button>
              <button
                onClick={() => { setShowCalib(false); setPendingQty(null); }}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}

      {/* Calibration feedback */}
      {calibResult && (
        <tr>
          <td colSpan={5} className="px-4 py-2.5">
            {calibResult.status === 'calibrated' ? (
              <div className="flex items-start gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5">
                <TrendingUp className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-green-800">
                    Estimate updated for {calibResult.jobLabel}
                  </p>
                  <p className="text-xs text-green-700 mt-0.5">
                    Your average is now <strong>{calibResult.newHours}hrs</strong> (was {calibResult.oldHours}hrs) — future quotes will use this automatically.
                  </p>
                </div>
                <button onClick={() => setCalibResult(null)} className="ml-auto text-green-400 hover:text-green-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">
                <TrendingUp className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Logged{calibResult.jobLabel ? ` for ${calibResult.jobLabel}` : ''} — {calibResult.correctionCount}/{calibResult.neededToCalibrate} corrections to auto-update the estimate.
                </span>
                <button onClick={() => setCalibResult(null)} className="ml-auto text-blue-400 hover:text-blue-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Send flow modal ──────────────────────────────────────────────────────────

function SendModal({
  quoteId, defaultWhatsapp, onClose,
}: { quoteId: string; defaultWhatsapp: string; onClose: () => void }) {
  const [whatsapp, setWhatsapp] = useState(defaultWhatsapp);
  const [sent, setSent]         = useState(false);
  const sendQuote = useSendQuote();

  const handleSend = async () => {
    const result = await sendQuote.mutateAsync({ id: quoteId, whatsappOverride: whatsapp || undefined });
    if (result.needsWhatsapp) return; // handled below
    setSent(true);
    setTimeout(onClose, 1500);
  };

  if (sent) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50 p-4">
        <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center">
          <div className="text-4xl mb-2">✅</div>
          <p className="font-bold text-gray-900">Quote sent!</p>
          <p className="text-sm text-gray-500 mt-1">Customer will receive it via WhatsApp</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-gray-900 mb-1">Send Quote via WhatsApp</h2>
        <p className="text-sm text-gray-500 mb-4">
          We'll generate a PDF and send it to the customer's WhatsApp number.
        </p>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Customer WhatsApp number
        </label>
        <input
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          className="input mb-4"
          placeholder="+447700900000"
          type="tel"
        />
        {sendQuote.error && (
          <p className="text-sm text-red-600 mb-3">Failed to send. Please try again.</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleSend}
            disabled={!whatsapp.trim() || sendQuote.isPending}
            className="btn-primary flex-1"
          >
            {sendQuote.isPending ? 'Sending…' : '📤 Send now'}
          </button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function QuoteDetailPage() {
  const { id }     = useParams<{ id: string }>();
  const navigate   = useNavigate();

  const { data: quote, isLoading } = useQuote(id!);
  const updateQuote    = useUpdateQuote();
  const updateLineItems = useUpdateLineItems();
  const deleteQuote    = useDeleteQuote();
  const generatePdf    = useGeneratePdf();

  const [showSend, setShowSend]   = useState(false);
  const [lineItems, setLineItems] = useState<QuoteLineItem[] | null>(null);
  const [dirty, setDirty]         = useState(false);

  // Sync local line items when quote loads
  const items = lineItems ?? (quote?.lineItems ?? []);

  const canEdit = !!quote && quote.status === 'draft';

  const updateItem = useCallback((idx: number, patch: Partial<QuoteLineItem>) => {
    setLineItems((prev) => {
      const base = prev ?? (quote?.lineItems ?? []);
      const next = base.map((it, i) =>
        i !== idx ? it : {
          ...it,
          ...patch,
          total: (patch.qty ?? it.qty) * (patch.unitPrice ?? it.unitPrice),
        },
      );
      setDirty(true);
      return next;
    });
  }, [quote?.lineItems]);

  const deleteItem = useCallback((idx: number) => {
    setLineItems((prev) => {
      const base = prev ?? (quote?.lineItems ?? []);
      const next = base.filter((_, i) => i !== idx);
      setDirty(true);
      return next;
    });
  }, [quote?.lineItems]);

  const addItem = () => {
    const newItem: QuoteLineItem = {
      id: `new-${Date.now()}`, quoteId: id!, description: 'New item',
      qty: 1, unitPrice: 0, total: 0, sortOrder: items.length,
    };
    setLineItems([...items, newItem]);
    setDirty(true);
  };

  const saveLineItems = async () => {
    if (!id || !lineItems) return;
    await updateLineItems.mutateAsync({
      id,
      lineItems: lineItems.map((li, i) => ({
        description: li.description, qty: li.qty, unitPrice: li.unitPrice,
        sortOrder: i,
      })),
    });
    setLineItems(null);
    setDirty(false);
  };

  const handleDelete = async () => {
    if (!confirm('Delete this quote?')) return;
    await deleteQuote.mutateAsync(id!);
    navigate('/quotes');
  };

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse max-w-2xl">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="card h-32" />
        <div className="card h-56" />
      </div>
    );
  }
  if (!quote) return <p className="text-gray-500">Quote not found.</p>;

  const shortId = quote.id.slice(0, 8).toUpperCase();

  // Subtotal from local items
  const localSubtotal = items.reduce((s, li) => s + li.qty * li.unitPrice, 0);

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">#{shortId}</h1>
            <span className={`badge ${STATUS_COLORS[quote.status]}`}>
              {STATUS_LABELS[quote.status]}
            </span>
          </div>
          <p className="text-sm text-gray-400 mt-1">
            {new Date(quote.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <button onClick={handleDelete} className="btn-secondary text-red-400 hover:text-red-600 p-2 shrink-0" title="Delete">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Customer + notes */}
      <div className="card p-4 space-y-3">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Customer</p>
          {canEdit ? (
            <InlineText
              value={quote.customerName}
              placeholder="Add customer name"
              className="text-sm font-medium"
              onSave={(v) => updateQuote.mutate({ id: id!, customerName: v })}
            />
          ) : (
            <p className="text-sm font-medium">{quote.customerName || '—'}</p>
          )}
          {quote.customerWhatsapp && (
            <p className="text-xs text-gray-400 mt-0.5">{quote.customerWhatsapp}</p>
          )}
        </div>
        {quote.notes && (
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-gray-600 whitespace-pre-line">{quote.notes}</p>
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">Line Items</p>
          {canEdit && dirty && (
            <button
              onClick={saveLineItems}
              disabled={updateLineItems.isPending}
              className="btn-primary text-xs py-1 px-3"
            >
              {updateLineItems.isPending ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 text-xs text-gray-400 font-medium">Description</th>
                <th className="text-center px-2 py-2 text-xs text-gray-400 font-medium">Qty</th>
                <th className="text-right px-2 py-2 text-xs text-gray-400 font-medium">Unit</th>
                <th className="text-right px-4 py-2 text-xs text-gray-400 font-medium">Total</th>
                {canEdit && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <LineItemRow
                  key={item.id}
                  item={item}
                  canEdit={canEdit}
                  quoteId={id!}
                  jobKey={quote.jobKey ?? undefined}
                  onUpdate={(patch) => updateItem(idx, patch)}
                  onDelete={() => deleteItem(idx)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="border-t border-gray-50 px-4 py-2">
            <button onClick={addItem} className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 py-1">
              <Plus className="h-3.5 w-3.5" /> Add line item
            </button>
          </div>
        )}

        {/* Totals */}
        <div className="border-t border-gray-100 px-4 py-3 space-y-1.5">
          <TotalRow label={`Subtotal${quote.vatAmount > 0 ? ' (ex VAT)' : ''}`} value={dirty ? localSubtotal : quote.subtotal} />
          {quote.vatAmount > 0 && <TotalRow label="VAT (20%)" value={quote.vatAmount} />}
          <TotalRow label="Total" value={dirty ? localSubtotal : quote.total} bold />
          {quote.depositAmount > 0 && <TotalRow label="Deposit to book" value={quote.depositAmount} muted />}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pb-8">
        {quote.status === 'draft' && (
          <button
            onClick={() => setShowSend(true)}
            className="btn-primary flex-1"
          >
            <Send className="h-4 w-4" />
            Send to Customer
          </button>
        )}

        <button
          onClick={() => generatePdf.mutate(id!, {
            onSuccess: (d) => window.open(d.pdfUrl),
            onError:   () => alert('PDF generation failed — please try again.'),
          })}
          disabled={generatePdf.isPending}
          className="btn-secondary"
        >
          <FileDown className="h-4 w-4" />
          {generatePdf.isPending ? 'Generating…' : 'PDF'}
        </button>

        {quote.pdfUrl && (
          <a href={quote.pdfUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">
            <ExternalLink className="h-4 w-4" />
            View PDF
          </a>
        )}

        {quote.status === 'sent' && (
          <>
            <button onClick={() => updateQuote.mutate({ id: id!, status: 'accepted' })} className="btn-primary">
              <CheckCircle className="h-4 w-4" /> Accepted
            </button>
            <button onClick={() => updateQuote.mutate({ id: id!, status: 'declined' })} className="btn-secondary text-red-500">
              <XCircle className="h-4 w-4" /> Declined
            </button>
          </>
        )}
      </div>

      {/* Send modal */}
      {showSend && (
        <SendModal
          quoteId={id!}
          defaultWhatsapp={quote.customerWhatsapp ?? ''}
          onClose={() => setShowSend(false)}
        />
      )}
    </div>
  );
}

function TotalRow({ label, value, bold, muted }: { label: string; value: number; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-bold text-base' : muted ? 'text-gray-400' : 'text-gray-600'}`}>
      <span>{label}</span>
      <span>{formatGBP(value)}</span>
    </div>
  );
}

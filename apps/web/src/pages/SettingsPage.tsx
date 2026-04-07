import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ChevronDown, ChevronUp, ToggleLeft, ToggleRight, LogOut, Zap } from 'lucide-react';
import { useAuthStore } from '../store/auth.ts';
import { useRateCard, useUpdateRateCard, useJobLibrary, useUpdateJobEntry, useUpdateProfile } from '../hooks/useTrader.ts';
import { api } from '../lib/api.ts';
import type { JobLibraryEntry } from '@quotebot/shared';

// ─── Section accordion ────────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-semibold text-gray-900">{title}</span>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-gray-100">{children}</div>}
    </div>
  );
}

// ─── Profile section ──────────────────────────────────────────────────────────

function ProfileSection() {
  const { trader, setTrader } = useAuthStore();
  const updateProfile = useUpdateProfile();

  type Form = { name: string; businessName: string; trade: string; location: string; whatsappNumber: string };
  const { register, handleSubmit, formState: { isDirty, errors } } = useForm<Form>({
    defaultValues: {
      name:           trader?.name ?? '',
      businessName:   trader?.businessName ?? '',
      trade:          trader?.trade ?? '',
      location:       trader?.location ?? '',
      whatsappNumber: trader?.whatsappNumber ?? '',
    },
  });

  return (
    <form
      onSubmit={handleSubmit(async (d) => {
        const res = await updateProfile.mutateAsync(d);
        if (res?.trader) setTrader(res.trader);
      })}
      className="space-y-4 pt-4"
    >
      <Field label="Your Name" error={errors.name?.message}>
        <input {...register('name', { required: 'Required' })} className="input" />
      </Field>
      <Field label="Business Name">
        <input {...register('businessName')} className="input" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Trade">
          <input {...register('trade')} className="input" placeholder="Electrician" />
        </Field>
        <Field label="Location">
          <input {...register('location')} className="input" placeholder="Manchester" />
        </Field>
      </div>
      <Field label="WhatsApp" hint="+44...">
        <input {...register('whatsappNumber')} type="tel" className="input" placeholder="+447700900000" />
      </Field>
      <SaveButton isPending={updateProfile.isPending} isDirty={isDirty} isSuccess={updateProfile.isSuccess} />
    </form>
  );
}

// ─── Rate card section ────────────────────────────────────────────────────────

function RateCardSection() {
  const { data: rc } = useRateCard();
  const updateRc = useUpdateRateCard();

  type Form = { labourRate: number; callOutFee: number; travelRatePerMile: number; markupPercent: number; vatRegistered: boolean; vatRate: number; depositPercent: number };
  const { register, handleSubmit, formState: { isDirty } } = useForm<Form>({
    defaultValues: {
      labourRate:        rc?.labourRate        ?? 45,
      callOutFee:        rc?.callOutFee        ?? 0,
      travelRatePerMile: rc?.travelRatePerMile ?? 0.45,
      markupPercent:     rc?.markupPercent     ?? 20,
      vatRegistered:     rc?.vatRegistered     ?? false,
      vatRate:           rc?.vatRate           ?? 0.20,
      depositPercent:    rc?.depositPercent    ?? 25,
    },
  });

  return (
    <form onSubmit={handleSubmit((d) => updateRc.mutate(d))} className="space-y-4 pt-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Labour Rate (£/hr)">
          <input {...register('labourRate')} type="number" min={0} step={0.01} className="input" />
        </Field>
        <Field label="Call-out Fee (£)">
          <input {...register('callOutFee')} type="number" min={0} step={0.01} className="input" />
        </Field>
        <Field label="Travel (£/mile)">
          <input {...register('travelRatePerMile')} type="number" min={0} step={0.01} className="input" />
        </Field>
        <Field label="Markup (%)">
          <input {...register('markupPercent')} type="number" min={0} step={1} className="input" />
        </Field>
        <Field label="Deposit (%)">
          <input {...register('depositPercent')} type="number" min={0} max={100} step={1} className="input" />
        </Field>
      </div>
      <label className="flex items-center gap-3 cursor-pointer">
        <input {...register('vatRegistered')} type="checkbox" className="h-4 w-4 rounded border-gray-300 text-brand-700" />
        <span className="text-sm font-medium text-gray-700">VAT registered (20%)</span>
      </label>
      <SaveButton isPending={updateRc.isPending} isDirty={isDirty} isSuccess={updateRc.isSuccess} />
    </form>
  );
}

// ─── Job library section ──────────────────────────────────────────────────────

function JobLibrarySection() {
  const { data: entries = [], isLoading } = useJobLibrary();
  const updateEntry = useUpdateJobEntry();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hoursDraft, setHoursDraft] = useState('');

  const startEdit = (e: JobLibraryEntry) => {
    setEditingId(e.id);
    setHoursDraft(String(e.labourHours));
  };

  const commitEdit = (entry: JobLibraryEntry) => {
    const next = parseFloat(hoursDraft);
    if (!isNaN(next) && next !== entry.labourHours) {
      updateEntry.mutate({ id: entry.id, labourHours: next });
    }
    setEditingId(null);
  };

  if (isLoading) return <div className="pt-4 space-y-2">{[1,2,3].map((i) => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}</div>;

  return (
    <div className="pt-4 space-y-2">
      {entries.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">No jobs configured yet.</p>
      )}
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-gray-200"
        >
          {/* Toggle active */}
          <button
            onClick={() => updateEntry.mutate({ id: entry.id, active: !entry.active })}
            className={`shrink-0 ${entry.active ? 'text-brand-700' : 'text-gray-300'}`}
          >
            {entry.active
              ? <ToggleRight className="h-6 w-6" />
              : <ToggleLeft  className="h-6 w-6" />}
          </button>

          {/* Label + calibration badge */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900 truncate">{entry.label}</span>
              {entry.isCustom && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                  <Zap className="h-3 w-3" />
                  Calibrated
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {entry.materials.length > 0 ? `${entry.materials.length} materials` : 'Labour only'}
            </p>
          </div>

          {/* Hours editor */}
          <div className="shrink-0 text-right">
            {editingId === entry.id ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  type="number"
                  value={hoursDraft}
                  onChange={(e) => setHoursDraft(e.target.value)}
                  onBlur={() => commitEdit(entry)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(entry); if (e.key === 'Escape') setEditingId(null); }}
                  className="input w-16 py-1 text-xs text-right"
                  min={0.1} step={0.25}
                />
                <span className="text-xs text-gray-400">hr</span>
              </div>
            ) : (
              <button
                onClick={() => startEdit(entry)}
                className="text-sm font-semibold text-brand-700 hover:underline"
              >
                {entry.labourHours}h
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        {hint && <span className="text-xs text-gray-400">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}

function SaveButton({ isPending, isDirty, isSuccess }: { isPending: boolean; isDirty: boolean; isSuccess: boolean }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <button type="submit" disabled={!isDirty || isPending} className="btn-primary">
        {isPending ? 'Saving…' : 'Save'}
      </button>
      {isSuccess && <p className="text-sm text-green-600">Saved ✓</p>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { trader, logout, refreshToken } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try { await api.post('/auth/logout', { refreshToken }); } catch { /* ignore */ }
    logout();
    navigate('/login');
  };

  return (
    <div className="space-y-4 max-w-lg pb-20">
      <h1 className="text-xl font-bold text-gray-900">Settings</h1>

      {/* Plan badge */}
      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900 capitalize">{trader?.plan ?? 'trial'} plan</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {trader?.quotesUsedThisMonth ?? 0} quotes used this month
          </p>
        </div>
        {trader?.plan !== 'pro' && (
          <button className="btn-primary text-xs">Upgrade</button>
        )}
      </div>

      <Section title="Business Profile" defaultOpen>
        <ProfileSection />
      </Section>

      <Section title="Pricing Defaults">
        <RateCardSection />
      </Section>

      <Section title="Job Library">
        <p className="text-xs text-gray-400 pt-3 mb-3">
          Toggle jobs on/off · tap hours to edit · calibrated badge shows AI has auto-adjusted from your corrections
        </p>
        <JobLibrarySection />
      </Section>

      {/* Sign out */}
      <button
        onClick={handleLogout}
        className="btn-secondary w-full text-red-500 hover:text-red-600 mt-2"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  );
}

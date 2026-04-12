import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import {
  ChevronDown, ChevronUp, ToggleLeft, ToggleRight,
  LogOut, Zap, Plus, Trash2, ChevronRight, X, Check, AlertCircle,
} from 'lucide-react';
import { useAuthStore } from '../store/auth.ts';
import {
  useRateCard, useUpdateRateCard,
  useJobLibrary, useUpdateJobEntry, useCreateJobEntry, useDeleteJobEntry, useUpdateJobMaterials,
  useMarkMaterialsReviewed,
  useUpdateProfile,
} from '../hooks/useTrader.ts';
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

  type Form = { name: string; businessName: string; trade: string; location: string; postcode: string; whatsappNumber: string };
  const { register, handleSubmit, formState: { isDirty, errors } } = useForm<Form>({
    defaultValues: {
      name:           trader?.name ?? '',
      businessName:   trader?.businessName ?? '',
      trade:          trader?.trade ?? '',
      location:       trader?.location ?? '',
      postcode:       trader?.postcode ?? '',
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
      <Field label="Your postcode" hint="Used to calculate travel distance on quotes">
        <input {...register('postcode')} className="input" placeholder="M1 1AA" style={{ textTransform: 'uppercase' }} />
      </Field>
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

  type Form = { labourRate: number; callOutFee: number; travelRatePerMile: number; markupPercent: number; vatRegistered: boolean; vatRate: number; depositPercent: number; minimumCharge: number; defaultPropertyType: string; defaultUrgency: string; defaultDistanceMiles: number };
  const { register, handleSubmit, formState: { isDirty } } = useForm<Form>({
    defaultValues: {
      labourRate:           rc?.labourRate           ?? 45,
      callOutFee:           rc?.callOutFee           ?? 0,
      travelRatePerMile:    rc?.travelRatePerMile    ?? 0.45,
      markupPercent:        rc?.markupPercent        ?? 20,
      vatRegistered:        rc?.vatRegistered        ?? false,
      vatRate:              rc?.vatRate              ?? 0.20,
      depositPercent:       rc?.depositPercent       ?? 25,
      minimumCharge:        rc?.minimumCharge        ?? 0,
      defaultPropertyType:  rc?.defaultPropertyType  ?? 'house',
      defaultUrgency:       rc?.defaultUrgency       ?? 'standard',
      defaultDistanceMiles: rc?.defaultDistanceMiles ?? 0,
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
        <Field label="Minimum charge (£)" hint="0 = no minimum">
          <input {...register('minimumCharge')} type="number" min={0} step={1} className="input" />
        </Field>
      </div>
      <label className="flex items-center gap-3 cursor-pointer">
        <input {...register('vatRegistered')} type="checkbox" className="h-4 w-4 rounded border-gray-300 text-brand-700" />
        <span className="text-sm font-medium text-gray-700">VAT registered (20%)</span>
      </label>

      {/* Extraction defaults */}
      <div className="border-t border-gray-100 pt-4 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Quote extraction defaults</p>
        <p className="text-xs text-gray-400">Used when the AI can't determine a field from your voice description.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default property type">
            <select {...register('defaultPropertyType')} className="input">
              <option value="house">House</option>
              <option value="flat_ground">Ground flat</option>
              <option value="flat_upper">Upper flat</option>
              <option value="commercial">Commercial</option>
              <option value="new_build">New build</option>
            </select>
          </Field>
          <Field label="Default urgency">
            <select {...register('defaultUrgency')} className="input">
              <option value="standard">Standard</option>
              <option value="next_day">Next day</option>
              <option value="same_day">Same day</option>
            </select>
          </Field>
        </div>
        <Field label="Default distance (miles)" hint="0 = no travel cost">
          <input {...register('defaultDistanceMiles')} type="number" min={0} step={0.5} className="input" />
        </Field>
      </div>

      <SaveButton isPending={updateRc.isPending} isDirty={isDirty} isSuccess={updateRc.isSuccess} />
    </form>
  );
}

// ─── Materials editor (per job) ───────────────────────────────────────────────

type DraftMaterial = { item: string; cost: string };

function MaterialsEditor({ entry, onClose }: { entry: JobLibraryEntry; onClose: () => void }) {
  const updateMaterials = useUpdateJobMaterials();
  const [rows, setRows] = useState<DraftMaterial[]>(
    entry.materials.length > 0
      ? entry.materials.map((m) => ({ item: m.item, cost: String(m.cost) }))
      : [{ item: '', cost: '' }],
  );

  const setRow = (i: number, field: keyof DraftMaterial, value: string) => {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  };
  const addRow = () => setRows((prev) => [...prev, { item: '', cost: '' }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    const materials = rows
      .filter((r) => r.item.trim() && r.cost.trim())
      .map((r) => ({ item: r.item.trim(), cost: parseFloat(r.cost) }))
      .filter((r) => !isNaN(r.cost));
    await updateMaterials.mutateAsync({ id: entry.id, materials });
    onClose();
  };

  return (
    <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
      <p className="text-xs font-medium text-gray-600 mb-2">Materials (supply cost, ex-markup)</p>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={row.item}
            onChange={(e) => setRow(i, 'item', e.target.value)}
            placeholder="e.g. Consumer unit 18-way"
            className="input flex-1 py-1.5 text-sm"
          />
          <div className="relative shrink-0 w-24">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">£</span>
            <input
              value={row.cost}
              onChange={(e) => setRow(i, 'cost', e.target.value)}
              placeholder="0.00"
              type="number"
              min={0}
              step={0.01}
              className="input pl-6 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={() => removeRow(i)}
            className="shrink-0 text-gray-300 hover:text-red-400 p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button onClick={addRow} className="flex items-center gap-1 text-xs text-brand-700 hover:underline mt-1">
        <Plus className="h-3 w-3" /> Add material
      </button>
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={save}
          disabled={updateMaterials.isPending}
          className="btn-primary text-xs py-1.5"
        >
          {updateMaterials.isPending ? 'Saving…' : 'Save materials'}
        </button>
        <button onClick={onClose} className="btn-secondary text-xs py-1.5">Cancel</button>
      </div>
    </div>
  );
}

// ─── Add custom job form ──────────────────────────────────────────────────────

type NewJobForm = { jobKey: string; label: string; labourHours: string };

function AddJobForm({ onDone }: { onDone: () => void }) {
  const createJob = useCreateJobEntry();
  const [form, setForm] = useState<NewJobForm>({ jobKey: '', label: '', labourHours: '' });
  const [materials, setMaterials] = useState<DraftMaterial[]>([]);
  const [error, setError] = useState('');

  const setField = (k: keyof NewJobForm, v: string) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      // Auto-derive jobKey from label
      if (k === 'label') {
        next.jobKey = v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      }
      return next;
    });
  };

  const addMaterial = () => setMaterials((m) => [...m, { item: '', cost: '' }]);
  const setMatRow = (i: number, field: keyof DraftMaterial, val: string) => {
    setMaterials((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  };
  const removeMat = (i: number) => setMaterials((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    setError('');
    const hours = parseFloat(form.labourHours);
    if (!form.label.trim()) return setError('Label is required');
    if (isNaN(hours) || hours <= 0) return setError('Labour hours must be a positive number');

    const mats = materials
      .filter((r) => r.item.trim() && r.cost.trim())
      .map((r) => ({ item: r.item.trim(), cost: parseFloat(r.cost) }))
      .filter((r) => !isNaN(r.cost));

    try {
      await createJob.mutateAsync({ jobKey: form.jobKey, label: form.label.trim(), labourHours: hours, materials: mats });
      onDone();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save';
      setError(msg);
    }
  };

  return (
    <div className="border border-brand-200 rounded-xl p-4 space-y-3 bg-brand-50/30">
      <p className="text-sm font-semibold text-gray-900">New custom job</p>

      <Field label="Job label">
        <input
          value={form.label}
          onChange={(e) => setField('label', e.target.value)}
          placeholder="e.g. Install EV charger"
          className="input"
        />
      </Field>

      <Field label="Job key" hint="auto-generated — editable">
        <input
          value={form.jobKey}
          onChange={(e) => setForm((f) => ({ ...f, jobKey: e.target.value.replace(/[^a-z0-9_]/g, '') }))}
          placeholder="install_ev_charger"
          className="input font-mono text-sm"
        />
      </Field>

      <Field label="Labour hours">
        <input
          value={form.labourHours}
          onChange={(e) => setField('labourHours', e.target.value)}
          type="number" min={0.25} step={0.25}
          placeholder="2.5"
          className="input"
        />
      </Field>

      {materials.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-600">Materials</p>
          {materials.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={row.item}
                onChange={(e) => setMatRow(i, 'item', e.target.value)}
                placeholder="Item name"
                className="input flex-1 py-1.5 text-sm"
              />
              <div className="relative shrink-0 w-24">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">£</span>
                <input
                  value={row.cost}
                  onChange={(e) => setMatRow(i, 'cost', e.target.value)}
                  type="number" min={0} step={0.01}
                  placeholder="0.00"
                  className="input pl-6 py-1.5 text-sm"
                />
              </div>
              <button onClick={() => removeMat(i)} className="text-gray-300 hover:text-red-400 p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button onClick={addMaterial} className="flex items-center gap-1 text-xs text-brand-700 hover:underline">
        <Plus className="h-3 w-3" /> Add material
      </button>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button onClick={submit} disabled={createJob.isPending} className="btn-primary text-xs py-1.5">
          {createJob.isPending ? 'Saving…' : 'Add job'}
        </button>
        <button onClick={onDone} className="btn-secondary text-xs py-1.5">Cancel</button>
      </div>
    </div>
  );
}

// ─── Job library section ──────────────────────────────────────────────────────

function JobLibrarySection() {
  const { data: entries = [], isLoading } = useJobLibrary();
  const updateEntry          = useUpdateJobEntry();
  const deleteEntry          = useDeleteJobEntry();
  const markReviewed         = useMarkMaterialsReviewed();
  const { trader }           = useAuthStore();

  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const reviewedAt     = trader?.materialsReviewedAt ? new Date(trader.materialsReviewedAt) : null;
  const needsReview    = !reviewedAt || (Date.now() - reviewedAt.getTime() > NINETY_DAYS_MS);
  const [editingHoursId, setEditingHoursId]       = useState<string | null>(null);
  const [hoursDraft, setHoursDraft]               = useState('');
  const [expandedMatsId, setExpandedMatsId]       = useState<string | null>(null);
  const [showAddForm, setShowAddForm]             = useState(false);
  const [confirmDeleteId, setConfirmDeleteId]     = useState<string | null>(null);

  const startEditHours = (e: JobLibraryEntry) => {
    setEditingHoursId(e.id);
    setHoursDraft(String(e.labourHours));
  };

  const commitHours = (entry: JobLibraryEntry) => {
    const next = parseFloat(hoursDraft);
    if (!isNaN(next) && next !== entry.labourHours) {
      updateEntry.mutate({ id: entry.id, labourHours: next });
    }
    setEditingHoursId(null);
  };

  const toggleMats = (id: string) => {
    setExpandedMatsId((prev) => prev === id ? null : id);
  };

  if (isLoading) return (
    <div className="pt-4 space-y-2">
      {[1,2,3].map((i) => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}
    </div>
  );

  const active   = entries.filter((e) => e.active);
  const inactive = entries.filter((e) => !e.active);

  return (
    <div className="pt-4 space-y-3">
      {/* Material cost review prompt */}
      {needsReview && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
          <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">
              {reviewedAt ? 'Material costs not reviewed in 90+ days' : 'Material costs not yet reviewed'}
            </p>
            <p className="text-xs text-amber-600 mt-0.5">Check prices haven't changed before your next quote.</p>
          </div>
          <button
            onClick={() => markReviewed.mutate()}
            disabled={markReviewed.isPending}
            className="shrink-0 text-xs font-medium text-amber-700 hover:text-amber-900 underline"
          >
            {markReviewed.isPending ? 'Saving…' : 'Mark reviewed'}
          </button>
        </div>
      )}

      {showAddForm ? (
        <AddJobForm onDone={() => setShowAddForm(false)} />
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-brand-300 hover:text-brand-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add custom job
        </button>
      )}

      {entries.length === 0 && !showAddForm && (
        <p className="text-sm text-gray-400 text-center py-4">No jobs configured yet.</p>
      )}

      {/* Active jobs */}
      {active.length > 0 && (
        <div className="space-y-1.5">
          {active.map((entry) => (
            <JobEntryRow
              key={entry.id}
              entry={entry}
              editingHoursId={editingHoursId}
              hoursDraft={hoursDraft}
              expandedMatsId={expandedMatsId}
              confirmDeleteId={confirmDeleteId}
              onToggle={() => updateEntry.mutate({ id: entry.id, active: false })}
              onStartEditHours={() => startEditHours(entry)}
              onHoursDraftChange={setHoursDraft}
              onCommitHours={() => commitHours(entry)}
              onCancelHours={() => setEditingHoursId(null)}
              onToggleMats={() => toggleMats(entry.id)}
              onCloseMats={() => setExpandedMatsId(null)}
              onDeleteClick={() => setConfirmDeleteId(entry.id)}
              onDeleteConfirm={() => { deleteEntry.mutate(entry.id); setConfirmDeleteId(null); }}
              onDeleteCancel={() => setConfirmDeleteId(null)}
            />
          ))}
        </div>
      )}

      {/* Inactive jobs */}
      {inactive.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide pt-1">Disabled</p>
          {inactive.map((entry) => (
            <JobEntryRow
              key={entry.id}
              entry={entry}
              editingHoursId={editingHoursId}
              hoursDraft={hoursDraft}
              expandedMatsId={expandedMatsId}
              confirmDeleteId={confirmDeleteId}
              onToggle={() => updateEntry.mutate({ id: entry.id, active: true })}
              onStartEditHours={() => startEditHours(entry)}
              onHoursDraftChange={setHoursDraft}
              onCommitHours={() => commitHours(entry)}
              onCancelHours={() => setEditingHoursId(null)}
              onToggleMats={() => toggleMats(entry.id)}
              onCloseMats={() => setExpandedMatsId(null)}
              onDeleteClick={() => setConfirmDeleteId(entry.id)}
              onDeleteConfirm={() => { deleteEntry.mutate(entry.id); setConfirmDeleteId(null); }}
              onDeleteCancel={() => setConfirmDeleteId(null)}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 text-center pt-1">
        Toggle jobs on/off · tap hours to edit · expand to edit materials
      </p>
    </div>
  );
}

// ─── Single job row ───────────────────────────────────────────────────────────

interface JobEntryRowProps {
  entry:              JobLibraryEntry;
  editingHoursId:     string | null;
  hoursDraft:         string;
  expandedMatsId:     string | null;
  confirmDeleteId:    string | null;
  onToggle:           () => void;
  onStartEditHours:   () => void;
  onHoursDraftChange: (v: string) => void;
  onCommitHours:      () => void;
  onCancelHours:      () => void;
  onToggleMats:       () => void;
  onCloseMats:        () => void;
  onDeleteClick:      () => void;
  onDeleteConfirm:    () => void;
  onDeleteCancel:     () => void;
}

function JobEntryRow({
  entry, editingHoursId, hoursDraft, expandedMatsId, confirmDeleteId,
  onToggle, onStartEditHours, onHoursDraftChange, onCommitHours, onCancelHours,
  onToggleMats, onCloseMats, onDeleteClick, onDeleteConfirm, onDeleteCancel,
}: JobEntryRowProps) {
  const isEditingHours = editingHoursId === entry.id;
  const isExpanded     = expandedMatsId === entry.id;
  const isConfirming   = confirmDeleteId === entry.id;
  const dimmed         = !entry.active;

  return (
    <div className={`rounded-xl border transition-colors ${dimmed ? 'border-gray-100 bg-gray-50/50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-2 p-3">
        {/* Active toggle */}
        <button onClick={onToggle} className={`shrink-0 ${entry.active ? 'text-brand-700' : 'text-gray-300'}`}>
          {entry.active ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
        </button>

        {/* Label + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-medium truncate ${dimmed ? 'text-gray-400' : 'text-gray-900'}`}>
              {entry.label}
            </span>
            {entry.isCustom && (
              <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                <Zap className="h-3 w-3" />
                Custom
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {entry.materials.length > 0 ? `${entry.materials.length} material${entry.materials.length > 1 ? 's' : ''}` : 'Labour only'}
          </p>
        </div>

        {/* Hours editor */}
        <div className="shrink-0 text-right">
          {isEditingHours ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                type="number"
                value={hoursDraft}
                onChange={(e) => onHoursDraftChange(e.target.value)}
                onBlur={onCommitHours}
                onKeyDown={(e) => { if (e.key === 'Enter') onCommitHours(); if (e.key === 'Escape') onCancelHours(); }}
                className="input w-16 py-1 text-xs text-right"
                min={0.1} step={0.25}
              />
              <span className="text-xs text-gray-400">hr</span>
            </div>
          ) : (
            <button onClick={onStartEditHours} className="text-sm font-semibold text-brand-700 hover:underline">
              {entry.labourHours}h
            </button>
          )}
        </div>

        {/* Materials expand */}
        <button onClick={onToggleMats} className="shrink-0 text-gray-400 hover:text-gray-600 p-1">
          <ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        </button>

        {/* Delete (custom only) */}
        {entry.isCustom && !isConfirming && (
          <button onClick={onDeleteClick} className="shrink-0 text-gray-200 hover:text-red-400 p-1">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        {isConfirming && (
          <div className="flex items-center gap-1">
            <button onClick={onDeleteConfirm} className="text-red-500 hover:text-red-600 p-1">
              <Check className="h-4 w-4" />
            </button>
            <button onClick={onDeleteCancel} className="text-gray-300 hover:text-gray-500 p-1">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Materials expand panel */}
      {isExpanded && (
        <div className="px-3 pb-3">
          <MaterialsEditor entry={entry} onClose={onCloseMats} />
        </div>
      )}
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
          <span className="text-xs text-gray-400 italic">Upgrade coming soon</span>
        )}
      </div>

      <Section title="Business Profile" defaultOpen>
        <ProfileSection />
      </Section>

      <Section title="Pricing Defaults">
        <RateCardSection />
      </Section>

      <Section title="Job Library">
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

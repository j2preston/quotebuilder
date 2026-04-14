import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, AlertCircle, ChevronRight, Info, CheckCircle2, Edit2, MapPin, Loader2, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuthStore } from '../store/auth.ts';

// ─── Postcode distance utilities ─────────────────────────────────────────────

async function lookupPostcodeLatLng(postcode: string): Promise<{ lat: number; lng: number }> {
  const clean = postcode.replace(/\s+/g, '').toUpperCase();
  const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`);
  if (!res.ok) throw new Error(`Invalid postcode: ${postcode}`);
  const data = await res.json() as { result: { latitude: number; longitude: number } };
  return { lat: data.result.latitude, lng: data.result.longitude };
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractedFields {
  jobKey: string;
  propertyType: 'house' | 'flat_ground' | 'flat_upper' | 'commercial' | 'new_build';
  urgency: 'standard' | 'next_day' | 'same_day';
  distanceMiles: number;
  complexityFlags: string[];
  customerName: string;
  notes: string;
  includeCallOut: boolean;
  confidence: 'high' | 'medium' | 'low';
  clarificationNeeded: string | null;
}

interface AvailableJob {
  jobKey: string;
  label: string;
}

interface FieldSources {
  propertyType:  'captured' | 'defaulted';
  urgency:       'captured' | 'defaulted';
  distanceMiles: 'captured' | 'defaulted';
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'recording'; liveText: string }
  | { kind: 'processing'; step: 'extracting' | 'pricing' }
  | { kind: 'confirmation'; fields: ExtractedFields; availableJobs: AvailableJob[]; fieldSources: FieldSources }
  | { kind: 'clarification'; question: string }
  | { kind: 'error'; message: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS: Array<{ key: 'extracting' | 'pricing'; label: string }> = [
  { key: 'extracting', label: 'Extracting job details…' },
  { key: 'pricing',    label: 'Calculating price…' },
];

const PROPERTY_LABELS: Record<ExtractedFields['propertyType'], string> = {
  house:       'House',
  flat_ground: 'Ground flat',
  flat_upper:  'Upper flat',
  commercial:  'Commercial',
  new_build:   'New build',
};

const URGENCY_LABELS: Record<ExtractedFields['urgency'], string> = {
  standard: 'Standard',
  next_day: 'Next day',
  same_day: 'Same day',
};

const COMPLEXITY_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'older_property',        label: 'Older property' },
  { key: 'no_existing_cable_run', label: 'No cable run' },
  { key: 'multiple_floors',       label: 'Multiple floors' },
];

// ─── SpeechRecognition compat shim ────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SR = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechRecognitionAPI: (new () => SR) | undefined = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

// ─── Main component ───────────────────────────────────────────────────────────

export default function DitatePage() {
  const navigate = useNavigate();
  const trader   = useAuthStore((s) => s.trader);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [clarificationAnswer, setClarificationAnswer] = useState('');

  const recogRef     = useRef<SR | null>(null);
  const finalTextRef = useRef('');
  const heldRef      = useRef(false);

  // ── Extract fields from transcript ─────────────────────────────────────────

  const submitTranscript = useCallback(async (transcript: string) => {
    if (!transcript.trim()) {
      setPhase({ kind: 'error', message: 'No speech detected — hold the button while speaking.' });
      return;
    }

    setPhase({ kind: 'processing', step: 'extracting' });

    try {
      const { data } = await api.post('/quotes/extract', { transcript });

      if (data.status === 'needs_clarification' && data.question) {
        setPhase({ kind: 'clarification', question: data.question });
        return;
      }

      if (data.status === 'extracted') {
        setPhase({
          kind:          'confirmation',
          fields:        data.fields as ExtractedFields,
          availableJobs: (data.availableJobs ?? []) as AvailableJob[],
          fieldSources:  (data.fieldSources ?? { propertyType: 'captured', urgency: 'captured', distanceMiles: 'captured' }) as FieldSources,
        });
        return;
      }

      setPhase({ kind: 'error', message: 'Could not extract job details. Please try again.' });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Something went wrong. Please try again.';
      setPhase({ kind: 'error', message: msg });
    }
  }, []);

  // ── Confirm and price ──────────────────────────────────────────────────────

  const confirmQuote = useCallback(async (fields: ExtractedFields) => {
    setPhase({ kind: 'processing', step: 'pricing' });

    try {
      const { data } = await api.post('/quotes/confirm', fields);

      if (data.status === 'ready' && data.quoteId) {
        navigate(`/quotes/${data.quoteId}`);
        return;
      }
      if (data.status === 'needs_clarification' && data.question) {
        setPhase({ kind: 'clarification', question: data.question });
        return;
      }
      setPhase({
        kind:    'error',
        message: data.warning ?? 'This job needs manual review. Please create the quote manually.',
      });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Something went wrong. Please try again.';
      setPhase({ kind: 'error', message: msg });
    }
  }, [navigate]);

  // ── Hold to record ─────────────────────────────────────────────────────────

  const startRecording = useCallback(() => {
    if (!SpeechRecognitionAPI) {
      setPhase({ kind: 'error', message: 'Speech recognition is not supported. Try Chrome or Safari.' });
      return;
    }

    finalTextRef.current = '';
    const recog = new SpeechRecognitionAPI();
    recog.continuous     = true;
    recog.interimResults = true;
    recog.lang           = 'en-GB';

    recog.onresult = (e: SR) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTextRef.current += t + ' ';
        else interim += t;
      }
      setPhase({ kind: 'recording', liveText: finalTextRef.current + interim });
    };

    recog.onerror = (e: SR) => {
      if (e.error === 'aborted') return;
      setPhase({ kind: 'error', message: `Microphone error: ${e.error}. Please try again.` });
    };

    recog.start();
    recogRef.current = recog;
    setPhase({ kind: 'recording', liveText: '' });
  }, []);

  const stopAndSubmit = useCallback(() => {
    if (!heldRef.current) return;
    heldRef.current = false;

    const recog = recogRef.current;
    if (!recog) return;

    recog.onend = () => submitTranscript(finalTextRef.current.trim());
    recog.stop();
  }, [submitTranscript]);

  const handlePointerDown = () => {
    if (phase.kind !== 'idle') return;
    heldRef.current = true;
    startRecording();
  };
  const handlePointerUp = () => stopAndSubmit();

  return (
    <div className="flex flex-col items-center min-h-[calc(100vh-8rem)] pb-20">
      <div className="w-full max-w-sm mx-auto pt-8 space-y-8">

        {/* Browser compatibility warning */}
        {!SpeechRecognitionAPI && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
            <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">
              Voice recording requires Chrome or Safari. You can still type a job description below.
            </p>
          </div>
        )}

        {/* Title */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Dictate a Quote</h1>
          <p className="text-sm text-gray-500 mt-1">
            {phase.kind === 'idle'          && 'Hold the button and describe the job'}
            {phase.kind === 'recording'     && 'Listening… release when done'}
            {phase.kind === 'processing'    && STEPS.find((s) => s.key === phase.step)?.label}
            {phase.kind === 'confirmation'  && 'Check the details — edit anything that\'s wrong'}
            {phase.kind === 'clarification' && 'One more thing…'}
            {phase.kind === 'error'         && 'Something went wrong'}
          </p>
        </div>

        {/* Live transcript */}
        {phase.kind === 'recording' && (
          <div className="min-h-[80px] px-4 py-3 rounded-xl bg-brand-50 border border-brand-100">
            {phase.liveText
              ? <p className="text-sm text-brand-700 leading-relaxed">{phase.liveText}</p>
              : <p className="text-sm text-brand-300 italic">Start speaking…</p>
            }
          </div>
        )}

        {/* Idle placeholder */}
        {phase.kind === 'idle' && (
          <div className="h-20 flex items-center justify-center">
            <div className="flex items-end gap-1 h-10">
              {Array.from({ length: 20 }, (_, i) => (
                <div
                  key={i}
                  className="w-1.5 rounded-full bg-brand-700 opacity-20"
                  style={{ height: `${20 + Math.sin(i * 0.8) * 15}%` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Processing spinner */}
        {phase.kind === 'processing' && (
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="relative h-24 w-24">
              <div className="absolute inset-0 rounded-full border-4 border-brand-100" />
              <div className="absolute inset-0 rounded-full border-4 border-brand-700 border-t-transparent animate-spin" />
            </div>
            <div className="space-y-2 w-full">
              {STEPS.map((s, i) => {
                const current = STEPS.findIndex((x) => x.key === phase.step);
                const done    = i < current;
                const active  = i === current;
                return (
                  <div key={s.key} className={`flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${active ? 'bg-brand-50' : ''}`}>
                    <div className={`h-2 w-2 rounded-full ${done ? 'bg-success' : active ? 'bg-brand-700 animate-pulse' : 'bg-gray-200'}`} />
                    <span className={`text-sm ${active ? 'font-medium text-brand-700' : done ? 'text-gray-400 line-through' : 'text-gray-400'}`}>
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Confirmation card ──────────────────────────────────────────────── */}
        {phase.kind === 'confirmation' && (
          <ConfirmationCard
            fields={phase.fields}
            availableJobs={phase.availableJobs}
            fieldSources={phase.fieldSources}
            traderPostcode={trader?.postcode ?? null}
            onConfirm={confirmQuote}
            onRetry={() => setPhase({ kind: 'idle' })}
          />
        )}

        {/* Clarification */}
        {phase.kind === 'clarification' && (
          <div className="space-y-4">
            <div className="card p-4 bg-amber-50 border-amber-200">
              <p className="text-sm font-medium text-amber-800">{phase.question}</p>
            </div>
            <textarea
              value={clarificationAnswer}
              onChange={(e) => setClarificationAnswer(e.target.value)}
              className="input min-h-[80px] resize-none"
              placeholder="Type your answer…"
              autoFocus
            />
            <button
              onClick={() => submitTranscript(clarificationAnswer)}
              disabled={!clarificationAnswer.trim()}
              className="btn-primary w-full"
            >
              <ChevronRight className="h-4 w-4" />
              Continue
            </button>
          </div>
        )}

        {/* Error */}
        {phase.kind === 'error' && (
          <div className="card p-4 border-red-200 bg-red-50 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-red-700">{phase.message}</p>
              <button
                onClick={() => setPhase({ kind: 'idle' })}
                className="text-sm text-red-600 font-medium mt-2 hover:underline"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Record button */}
        {SpeechRecognitionAPI && (phase.kind === 'idle' || phase.kind === 'recording') && (
          <div className="flex flex-col items-center gap-4 pt-4">
            <button
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className={`
                w-32 h-32 rounded-full flex items-center justify-center
                select-none touch-none shadow-lg transition-all duration-150
                ${phase.kind === 'recording'
                  ? 'bg-red-500 scale-110 shadow-red-300'
                  : 'bg-brand-700 hover:bg-brand-600 active:scale-95'}
              `}
            >
              {phase.kind === 'recording'
                ? <MicOff className="h-14 w-14 text-white" />
                : <Mic    className="h-14 w-14 text-white" />
              }
            </button>
            <p className="text-xs text-gray-400 text-center">
              {phase.kind === 'recording'
                ? 'Release to generate quote'
                : 'Hold to record · release to submit'}
            </p>
          </div>
        )}

        {/* Text fallback */}
        {!SpeechRecognitionAPI && phase.kind === 'idle' && (
          <div className="space-y-3">
            <textarea
              className="input min-h-[100px] resize-none w-full"
              placeholder='Describe the job, e.g. "Replace consumer unit at a 3-bed semi, standard urgency, customer Mrs Davies"'
              id="text-fallback"
            />
            <button
              className="btn-primary w-full"
              onClick={() => {
                const el = document.getElementById('text-fallback') as HTMLTextAreaElement;
                submitTranscript(el.value);
              }}
            >
              <ChevronRight className="h-4 w-4" /> Generate quote
            </button>
          </div>
        )}

        {/* Example phrases */}
        {phase.kind === 'idle' && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 text-center font-medium uppercase tracking-wide">Example phrases</p>
            {[
              '"Replace consumer unit at a 3-bed semi in Salford, standard urgency, customer is Mrs Davies"',
              '"Fit two double sockets in a new build flat, urgency next day"',
              '"Full rewire of old Victorian property, complex job, customer John Smith"',
            ].map((phrase, i) => (
              <div key={i} className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 italic">
                {phrase}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Confirmation card ────────────────────────────────────────────────────────

function DefaultBadge() {
  return (
    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-400 border border-gray-200">
      default
    </span>
  );
}

function ConfirmationCard({
  fields: initialFields,
  availableJobs,
  fieldSources,
  traderPostcode,
  onConfirm,
  onRetry,
}: {
  fields: ExtractedFields;
  availableJobs: AvailableJob[];
  fieldSources: FieldSources;
  traderPostcode: string | null;
  onConfirm: (fields: ExtractedFields) => void;
  onRetry: () => void;
}) {
  const [fields, setFields] = useState<ExtractedFields>(initialFields);
  const set = <K extends keyof ExtractedFields>(key: K, value: ExtractedFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  const toggleFlag = (flag: string) => {
    setFields((f) => ({
      ...f,
      complexityFlags: f.complexityFlags.includes(flag)
        ? f.complexityFlags.filter((x) => x !== flag)
        : [...f.complexityFlags, flag],
    }));
  };

  // Postcode lookup state
  const [customerPostcode, setCustomerPostcode] = useState('');
  const [lookingUp,        setLookingUp]        = useState(false);
  const [lookupError,      setLookupError]       = useState<string | null>(null);
  const [lookedUpMiles,    setLookedUpMiles]     = useState<number | null>(initialFields.distanceMiles > 0 ? initialFields.distanceMiles : null);

  // Inline mileage edit
  const [editingMiles, setEditingMiles] = useState(false);
  const [milesDraft,   setMilesDraft]   = useState('');

  const commitMiles = () => {
    const val = parseFloat(milesDraft);
    if (!isNaN(val) && val >= 0) {
      set('distanceMiles', val);
      setLookedUpMiles(val > 0 ? val : null);
    }
    setEditingMiles(false);
  };

  async function handlePostcodeLookup() {
    const customer = customerPostcode.trim();
    if (!customer) return;
    if (!traderPostcode) {
      setLookupError('Add your postcode in Settings first to enable distance calculation.');
      return;
    }
    setLookingUp(true);
    setLookupError(null);
    try {
      const [from, to] = await Promise.all([
        lookupPostcodeLatLng(traderPostcode),
        lookupPostcodeLatLng(customer),
      ]);
      const miles = Math.round(haversineMiles(from.lat, from.lng, to.lat, to.lng) * 10) / 10;
      setLookedUpMiles(miles);
      set('distanceMiles', miles);
    } catch {
      setLookupError('Postcode not found — check the postcode and try again.');
    } finally {
      setLookingUp(false);
    }
  }

  return (
    <div className="space-y-5">

      {/* Job type */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Job</label>
        {availableJobs.length > 0 ? (
          <select
            value={fields.jobKey}
            onChange={(e) => set('jobKey', e.target.value)}
            className="input w-full"
          >
            {availableJobs.map((j) => (
              <option key={j.jobKey} value={j.jobKey}>{j.label}</option>
            ))}
            <option value={fields.jobKey} disabled={availableJobs.some((j) => j.jobKey === fields.jobKey)}>
              {fields.jobKey}
            </option>
          </select>
        ) : (
          <p className="text-sm text-gray-700 px-3 py-2 bg-gray-50 rounded-lg">{fields.jobKey}</p>
        )}
      </div>

      {/* Property type chips */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center">
          Property{fieldSources.propertyType === 'defaulted' && <DefaultBadge />}
        </label>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PROPERTY_LABELS) as ExtractedFields['propertyType'][]).map((pt) => (
            <button
              key={pt}
              onClick={() => set('propertyType', pt)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                fields.propertyType === pt
                  ? 'bg-brand-700 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {PROPERTY_LABELS[pt]}
            </button>
          ))}
        </div>
      </div>

      {/* Urgency chips */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center">
          Urgency{fieldSources.urgency === 'defaulted' && <DefaultBadge />}
        </label>
        <div className="flex gap-2">
          {(Object.keys(URGENCY_LABELS) as ExtractedFields['urgency'][]).map((u) => (
            <button
              key={u}
              onClick={() => set('urgency', u)}
              className={`flex-1 py-1.5 rounded-full text-sm font-medium transition-colors ${
                fields.urgency === u
                  ? u === 'same_day'
                    ? 'bg-red-500 text-white'
                    : u === 'next_day'
                      ? 'bg-amber-500 text-white'
                      : 'bg-brand-700 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {URGENCY_LABELS[u]}
            </button>
          ))}
        </div>
      </div>

      {/* Customer name */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
          <Edit2 className="h-3 w-3" /> Customer name
        </label>
        <input
          type="text"
          value={fields.customerName}
          onChange={(e) => set('customerName', e.target.value)}
          className="input w-full"
          placeholder="Optional"
        />
      </div>

      {/* Travel distance — postcode lookup */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
          <MapPin className="h-3 w-3" /> Customer postcode{fieldSources.distanceMiles === 'defaulted' && <DefaultBadge />}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={customerPostcode}
            onChange={(e) => { setCustomerPostcode(e.target.value.toUpperCase()); setLookupError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handlePostcodeLookup(); }}
            className="input flex-1 text-sm"
            placeholder="SW1A 1AA"
            style={{ textTransform: 'uppercase' }}
          />
          <button
            onClick={() => void handlePostcodeLookup()}
            disabled={!customerPostcode.trim() || lookingUp}
            className="btn-secondary text-sm px-3 shrink-0"
          >
            {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Look up'}
          </button>
        </div>
        {lookupError && <p className="text-xs text-red-500">{lookupError}</p>}

        {/* Distance result / inline edit */}
        <div className="flex items-center gap-2 pt-1">
          {editingMiles ? (
            <>
              <input
                autoFocus
                type="number"
                min={0}
                step={0.5}
                value={milesDraft}
                onChange={(e) => setMilesDraft(e.target.value)}
                onBlur={commitMiles}
                onKeyDown={(e) => { if (e.key === 'Enter') commitMiles(); if (e.key === 'Escape') setEditingMiles(false); }}
                className="input w-20 text-sm py-1"
              />
              <span className="text-xs text-gray-400">mi</span>
              <button onClick={() => setEditingMiles(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={() => { setMilesDraft(String(fields.distanceMiles || '')); setEditingMiles(true); }}
              className="flex items-center gap-1 text-xs text-brand-700 hover:underline"
            >
              {lookedUpMiles !== null && !lookupError && (
                <CheckCircle2 className="h-3 w-3" />
              )}
              {fields.distanceMiles > 0 ? `${fields.distanceMiles} mi` : 'Set distance manually'}
              <Edit2 className="h-3 w-3 text-gray-400 ml-0.5" />
            </button>
          )}
        </div>
      </div>

      {/* Call-out fee */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Call-out fee</label>
        <button
          onClick={() => set('includeCallOut', !fields.includeCallOut)}
          className={`w-full py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
            fields.includeCallOut
              ? 'bg-brand-700 text-white border-brand-700'
              : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400'
          }`}
        >
          {fields.includeCallOut ? <><CheckCircle2 className="h-4 w-4 inline mr-1" />Included</> : 'Not included'}
        </button>
      </div>

      {/* Complexity flags */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Complexity</label>
        <div className="flex flex-wrap gap-2">
          {COMPLEXITY_OPTIONS.map(({ key, label }) => {
            const active = fields.complexityFlags.includes(key);
            return (
              <button
                key={key}
                onClick={() => toggleFlag(key)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  active
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {active && <CheckCircle2 className="h-3 w-3 inline mr-1" />}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      {fields.notes && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Notes</label>
          <textarea
            value={fields.notes}
            onChange={(e) => set('notes', e.target.value)}
            className="input min-h-[60px] resize-none w-full"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onRetry}
          className="btn-secondary flex-1"
        >
          Re-dictate
        </button>
        <button
          onClick={() => onConfirm(fields)}
          className="btn-primary flex-1"
        >
          <ChevronRight className="h-4 w-4" />
          Price it
        </button>
      </div>

    </div>
  );
}

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, ChevronRight, ChevronLeft, Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { useAuthStore } from '../store/auth.ts';
import { useCompleteOnboarding } from '../hooks/useTrader.ts';
import type { RateCard, JobLibraryEntry } from '@quotebot/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'rates' | 'jobs' | 'materials' | 'whatsapp';
const STEPS: Step[] = ['rates', 'jobs', 'materials', 'whatsapp'];
const STEP_TITLES: Record<Step, string> = {
  rates:     'How do you charge?',
  jobs:      'Which jobs do you do?',
  materials: 'What do you supply?',
  whatsapp:  'Connect WhatsApp',
};
const STEP_SUBTITLES: Record<Step, string> = {
  rates:     'These go into every quote automatically. You can change them anytime in Settings.',
  jobs:      'Tick the jobs you take on and set how long each typically takes you.',
  materials: 'Update costs to match your supplier prices — this is what gets quoted to customers.',
  whatsapp:  'Your customers receive quotes directly on WhatsApp.',
};

interface JobState {
  active:      boolean;
  labourHours: number;
}

interface MaterialRow {
  item: string;
  cost: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const navigate  = useNavigate();
  const { trader, setTrader } = useAuthStore();
  const complete  = useCompleteOnboarding();

  const [step,   setStep]   = useState<Step>('rates');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  // ── Step 1: Rates ──────────────────────────────────────────────────────────
  const [rates, setRates] = useState({
    labourRate:     45,
    callOutFee:     45,
    markupPercent:  20,
    vatRegistered:  false,
    depositPercent: 30,
    minimumCharge:  0,
  });

  const { data: rateCardData } = useQuery({
    queryKey: ['trader', 'me'],
    queryFn: async () => {
      const { data } = await api.get('/trader/me');
      return data as { rateCard: RateCard | null };
    },
  });

  useEffect(() => {
    if (rateCardData?.rateCard) {
      const rc = rateCardData.rateCard;
      setRates({
        labourRate:     rc.labourRate,
        callOutFee:     rc.callOutFee,
        markupPercent:  rc.markupPercent,
        vatRegistered:  rc.vatRegistered,
        depositPercent: rc.depositPercent,
        minimumCharge:  rc.minimumCharge,
      });
    }
  }, [rateCardData]);

  // ── Step 2: Jobs ───────────────────────────────────────────────────────────
  const [jobStates, setJobStates] = useState<Record<string, JobState>>({});

  const { data: jobLibrary } = useQuery({
    queryKey: ['trader', 'job-library'],
    queryFn: async () => {
      const { data } = await api.get('/trader/job-library');
      return (data.jobLibrary ?? []) as JobLibraryEntry[];
    },
  });

  useEffect(() => {
    if (jobLibrary) {
      const initial: Record<string, JobState> = {};
      for (const job of jobLibrary) {
        initial[job.id] = { active: job.active, labourHours: job.labourHours };
      }
      setJobStates(initial);
    }
  }, [jobLibrary]);

  // ── Step 3: Materials ──────────────────────────────────────────────────────
  const [materialStates, setMaterialStates] = useState<Record<string, MaterialRow[]>>({});

  useEffect(() => {
    if (jobLibrary) {
      const initial: Record<string, MaterialRow[]> = {};
      for (const job of jobLibrary) {
        if (job.materials.length > 0) {
          initial[job.id] = job.materials.map((m) => ({ item: m.item, cost: m.cost }));
        }
      }
      setMaterialStates(initial);
    }
  }, [jobLibrary]);

  // ── Step 4: WhatsApp ───────────────────────────────────────────────────────
  const [whatsapp, setWhatsapp] = useState(trader?.whatsappNumber ?? '');

  // ── Navigation helpers ─────────────────────────────────────────────────────
  const stepIndex = STEPS.indexOf(step);

  async function saveAndAdvance() {
    setError(null);
    setSaving(true);
    try {
      if (step === 'rates') {
        await api.put('/trader/rate-card', rates);
        setStep('jobs');
      } else if (step === 'jobs') {
        await Promise.all(
          Object.entries(jobStates).map(([id, state]) =>
            api.put(`/trader/job-library/${id}`, {
              active:      state.active,
              labourHours: state.labourHours,
            }),
          ),
        );
        // Skip materials step if no active jobs have materials
        const activeJobsWithMaterials = (jobLibrary ?? []).filter(
          (j) => jobStates[j.id]?.active && (materialStates[j.id]?.length ?? 0) > 0,
        );
        setStep(activeJobsWithMaterials.length > 0 ? 'materials' : 'whatsapp');
      } else if (step === 'materials') {
        await Promise.all(
          Object.entries(materialStates).map(([id, mats]) =>
            api.put(`/trader/job-library/${id}/materials`, { materials: mats }),
          ),
        );
        setStep('whatsapp');
      } else if (step === 'whatsapp') {
        if (whatsapp.trim()) {
          await api.put('/trader/profile', { whatsappNumber: whatsapp.trim() });
        }
        await complete.mutateAsync();
        // Update store so RequireAuth sees onboardingComplete=true before navigating
        const current = useAuthStore.getState().trader;
        if (current) setTrader({ ...current, onboardingComplete: true });
        navigate('/dashboard', { replace: true });
      }
    } catch {
      setError('Something went wrong saving your settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function goBack() {
    const prev = STEPS[stepIndex - 1];
    if (prev) setStep(prev);
  }

  // ── Active jobs with materials (for step 3) ────────────────────────────────
  const activeJobsWithMaterials = (jobLibrary ?? []).filter(
    (j) => jobStates[j.id]?.active && (materialStates[j.id]?.length ?? 0) > 0,
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-6 w-6 text-brand-700" />
            <span className="font-bold text-brand-700">QuoteBot</span>
          </div>
          <span className="text-sm text-gray-500">Setup</span>
        </div>
      </div>

      {/* Progress */}
      <div className="bg-white border-b border-gray-100 px-4 py-3">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full transition-colors ${
                  i < stepIndex  ? 'bg-brand-700' :
                  i === stepIndex ? 'bg-brand-700 ring-2 ring-brand-200' :
                  'bg-gray-200'
                }`} />
                {i < STEPS.length - 1 && (
                  <div className={`h-px w-8 ${i < stepIndex ? 'bg-brand-700' : 'bg-gray-200'}`} />
                )}
              </div>
            ))}
            <span className="ml-2 text-xs text-gray-500">Step {stepIndex + 1} of {STEPS.length}</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-4 py-6">
        <div className="max-w-lg mx-auto">
          <h1 className="text-xl font-semibold text-gray-900 mb-1">{STEP_TITLES[step]}</h1>
          <p className="text-sm text-gray-500 mb-6">{STEP_SUBTITLES[step]}</p>

          {/* ── Step 1: Rates ── */}
          {step === 'rates' && (
            <div className="card p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Labour rate (£/hr)</label>
                  <input
                    type="number" min={1} step={0.5}
                    className="input"
                    value={rates.labourRate}
                    onChange={(e) => setRates((r) => ({ ...r, labourRate: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Call-out fee (£)</label>
                  <input
                    type="number" min={0} step={1}
                    className="input"
                    value={rates.callOutFee}
                    onChange={(e) => setRates((r) => ({ ...r, callOutFee: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Material markup (%)</label>
                  <input
                    type="number" min={0} max={100} step={1}
                    className="input"
                    value={rates.markupPercent}
                    onChange={(e) => setRates((r) => ({ ...r, markupPercent: Number(e.target.value) }))}
                  />
                  <p className="text-xs text-gray-400 mt-1">Added on top of material cost</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Deposit required (%)</label>
                  <input
                    type="number" min={0} max={100} step={5}
                    className="input"
                    value={rates.depositPercent}
                    onChange={(e) => setRates((r) => ({ ...r, depositPercent: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Minimum job charge (£)</label>
                <input
                  type="number" min={0} step={1}
                  className="input"
                  value={rates.minimumCharge}
                  onChange={(e) => setRates((r) => ({ ...r, minimumCharge: Number(e.target.value) }))}
                />
                <p className="text-xs text-gray-400 mt-1">Quotes below this are topped up automatically. 0 = no minimum.</p>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-brand-700"
                  checked={rates.vatRegistered}
                  onChange={(e) => setRates((r) => ({ ...r, vatRegistered: e.target.checked }))}
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">VAT registered</span>
                  <p className="text-xs text-gray-400">20% VAT will be added to all quotes</p>
                </div>
              </label>
            </div>
          )}

          {/* ── Step 2: Jobs & Hours ── */}
          {step === 'jobs' && (
            <div className="space-y-2">
              {!jobLibrary ? (
                <p className="text-sm text-gray-500">Loading your job library…</p>
              ) : jobLibrary.length === 0 ? (
                <p className="text-sm text-gray-500">No jobs found for your trade. You can add custom jobs in Settings.</p>
              ) : (
                <>
                  <div className="card divide-y divide-gray-100">
                    {jobLibrary.map((job) => {
                      const state = jobStates[job.id] ?? { active: job.active, labourHours: job.labourHours };
                      return (
                        <div key={job.id} className="flex items-center gap-3 px-4 py-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 text-brand-700 shrink-0"
                            checked={state.active}
                            onChange={(e) =>
                              setJobStates((prev) => ({
                                ...prev,
                                [job.id]: { ...state, active: e.target.checked },
                              }))
                            }
                          />
                          <span className={`flex-1 text-sm ${state.active ? 'text-gray-900' : 'text-gray-400'}`}>
                            {job.label}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <input
                              type="number" min={0.25} max={100} step={0.25}
                              disabled={!state.active}
                              className="input w-20 text-sm py-1 disabled:opacity-40"
                              value={state.labourHours}
                              onChange={(e) =>
                                setJobStates((prev) => ({
                                  ...prev,
                                  [job.id]: { ...state, labourHours: Number(e.target.value) },
                                }))
                              }
                            />
                            <span className="text-xs text-gray-400">hrs</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-400 px-1">
                    Your actual average beats a generic estimate — these hours directly affect your quote price.
                  </p>
                </>
              )}
            </div>
          )}

          {/* ── Step 3: Materials ── */}
          {step === 'materials' && (
            <div className="space-y-4">
              {activeJobsWithMaterials.length === 0 ? (
                <p className="text-sm text-gray-500">No material costs to configure for your active jobs.</p>
              ) : (
                activeJobsWithMaterials.map((job) => {
                  const rows = materialStates[job.id] ?? [];
                  return (
                    <div key={job.id} className="card p-4">
                      <h3 className="text-sm font-semibold text-gray-800 mb-3">{job.label}</h3>
                      <div className="space-y-2">
                        {rows.map((row, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              className="input flex-1 text-sm py-1.5"
                              value={row.item}
                              onChange={(e) =>
                                setMaterialStates((prev) => {
                                  const updated = [...(prev[job.id] ?? [])];
                                  updated[idx] = { ...updated[idx], item: e.target.value };
                                  return { ...prev, [job.id]: updated };
                                })
                              }
                            />
                            <span className="text-gray-400 text-sm">£</span>
                            <input
                              type="number" min={0} step={0.01}
                              className="input w-24 text-sm py-1.5"
                              value={row.cost}
                              onChange={(e) =>
                                setMaterialStates((prev) => {
                                  const updated = [...(prev[job.id] ?? [])];
                                  updated[idx] = { ...updated[idx], cost: Number(e.target.value) };
                                  return { ...prev, [job.id]: updated };
                                })
                              }
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400 mt-2">Update to your actual supplier prices.</p>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ── Step 4: WhatsApp ── */}
          {step === 'whatsapp' && (
            <div className="card p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Your WhatsApp number</label>
                <input
                  type="tel"
                  className="input"
                  placeholder="+447700900000"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                />
                <p className="text-xs text-gray-400 mt-1">Use international format, e.g. +447700900000</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 space-y-1">
                <p className="font-medium">Also needed: Twilio setup</p>
                <p>To send quotes via WhatsApp, you'll need to connect a Twilio number to your account. See the setup guide in Settings after finishing.</p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && <p className="text-sm text-red-500 mt-3">{error}</p>}

          {/* Navigation */}
          <div className="flex gap-3 mt-6">
            {stepIndex > 0 && (
              <button
                onClick={goBack}
                disabled={saving}
                className="btn-secondary flex items-center gap-1"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            )}
            <button
              onClick={saveAndAdvance}
              disabled={saving}
              className="btn-primary flex items-center gap-1 ml-auto"
            >
              {saving ? 'Saving…' :
               step === 'whatsapp' && whatsapp.trim() ? <><Check className="h-4 w-4" /> Finish setup</> :
               step === 'whatsapp' ? 'Skip & finish' :
               <>Next <ChevronRight className="h-4 w-4" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

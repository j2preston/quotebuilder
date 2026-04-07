import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, AlertCircle, ChevronRight } from 'lucide-react';
import { api } from '../lib/api.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | { kind: 'idle' }
  | { kind: 'recording'; liveText: string }
  | { kind: 'processing'; step: 'extracting' | 'pricing' }
  | { kind: 'clarification'; question: string }
  | { kind: 'error'; message: string };

// ─── Processing steps ─────────────────────────────────────────────────────────

const STEPS: Array<{ key: 'extracting' | 'pricing'; label: string }> = [
  { key: 'extracting', label: 'Extracting job details…' },
  { key: 'pricing',    label: 'Calculating price…' },
];

// ─── SpeechRecognition compat shim ────────────────────────────────────────────
// TypeScript's DOM lib may not include SpeechRecognition; access via window cast.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SR = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechRecognitionAPI: (new () => SR) | undefined = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

// ─── Main component ───────────────────────────────────────────────────────────

export default function DitatePage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [clarificationAnswer, setClarificationAnswer] = useState('');

  const recogRef     = useRef<SR | null>(null);
  const finalTextRef = useRef('');
  const heldRef      = useRef(false);

  // ── Submit text transcript to Anthropic-backed /generate ──────────────────

  const submitTranscript = useCallback(async (transcript: string) => {
    if (!transcript.trim()) {
      setPhase({ kind: 'error', message: 'No speech detected — hold the button while speaking.' });
      return;
    }

    setPhase({ kind: 'processing', step: 'extracting' });

    try {
      const stepDelay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      await stepDelay(400);
      setPhase({ kind: 'processing', step: 'pricing' });

      const { data } = await api.post('/quotes/generate', { transcript });
      await stepDelay(300);

      if (data.status === 'ready' && data.quoteId) {
        navigate(`/quotes/${data.quoteId}`);
        return;
      }
      if (data.status === 'needs_clarification' && data.question) {
        setPhase({ kind: 'clarification', question: data.question });
        return;
      }
      setPhase({
        kind: 'error',
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
      setPhase({
        kind: 'error',
        message: 'Speech recognition is not supported in this browser. Try Chrome or Safari.',
      });
      return;
    }

    finalTextRef.current = '';
    const recog = new SpeechRecognitionAPI();
    recog.continuous      = true;
    recog.interimResults  = true;
    recog.lang            = 'en-GB';

    recog.onresult = (e: SR) => {
      let interim = '';
      let final   = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          final   += t;
          finalTextRef.current += t + ' ';
        } else {
          interim += t;
        }
      }
      void final; // used via finalTextRef
      setPhase({ kind: 'recording', liveText: finalTextRef.current + interim });
    };

    recog.onerror = (e: SR) => {
      if (e.error === 'aborted') return; // normal stop
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

    recog.onend = () => {
      submitTranscript(finalTextRef.current.trim());
    };
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

        {/* Title */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Dictate a Quote</h1>
          <p className="text-sm text-gray-500 mt-1">
            {phase.kind === 'idle'          && 'Hold the button and describe the job'}
            {phase.kind === 'recording'     && 'Listening… release when done'}
            {phase.kind === 'processing'    && STEPS.find((s) => s.key === phase.step)?.label}
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
        {(phase.kind === 'idle' || phase.kind === 'recording') && (
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

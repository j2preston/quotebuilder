import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Upload, FileText, Loader2 } from 'lucide-react';
import { useUploadVoice } from '../hooks/useQuotes.ts';
import { JOB_TYPE_LABELS } from '@quotebot/shared';

type Mode = 'choose' | 'voice' | 'manual';

export default function NewQuotePage() {
  const [mode, setMode] = useState<Mode>('choose');
  const navigate = useNavigate();

  return (
    <div className="max-w-lg mx-auto pb-20 md:pb-0">
      <h1 className="text-xl font-bold text-gray-900 mb-6">New Quote</h1>

      {mode === 'choose' && (
        <div className="grid gap-4">
          <button
            onClick={() => setMode('voice')}
            className="card p-6 text-left hover:border-brand-300 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="bg-brand-50 p-3 rounded-xl">
                <Mic className="h-6 w-6 text-brand-700" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Voice Note</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  Record or upload a voice note — AI does the rest
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => setMode('manual')}
            className="card p-6 text-left hover:border-brand-300 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="bg-gray-50 p-3 rounded-xl">
                <FileText className="h-6 w-6 text-gray-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Manual Entry</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  Fill in job details and line items manually
                </p>
              </div>
            </div>
          </button>
        </div>
      )}

      {mode === 'voice' && (
        <VoiceUpload onSuccess={(quoteId) => navigate(`/quotes/${quoteId}`)} onBack={() => setMode('choose')} />
      )}

      {mode === 'manual' && (
        <ManualEntry onBack={() => setMode('choose')} />
      )}
    </div>
  );
}

function VoiceUpload({ onSuccess, onBack }: { onSuccess: (id: string) => void; onBack: () => void }) {
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { mutate: uploadVoice, isPending } = useUploadVoice();

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    chunksRef.current = [];
    mr.ondataavailable = (e) => chunksRef.current.push(e.data);
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const file = new File([blob], 'recording.webm', { type: 'audio/webm' });
      uploadVoice(file, { onSuccess: (d) => onSuccess(d.quoteId) });
      stream.getTracks().forEach((t) => t.stop());
    };
    mr.start();
    setMediaRecorder(mr);
    setRecording(true);
  };

  const stopRecording = () => {
    mediaRecorder?.stop();
    setRecording(false);
    setMediaRecorder(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadVoice(file, { onSuccess: (d) => onSuccess(d.quoteId) });
  };

  if (isPending) {
    return (
      <div className="card p-10 text-center">
        <Loader2 className="h-10 w-10 text-brand-700 animate-spin mx-auto mb-4" />
        <p className="font-medium text-gray-900">Processing your voice note…</p>
        <p className="text-sm text-gray-500 mt-1">Transcribing and extracting job details</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>

      <div className="card p-8 text-center">
        <button
          onClick={recording ? stopRecording : startRecording}
          className={`w-24 h-24 rounded-full mx-auto flex items-center justify-center transition-all ${
            recording
              ? 'bg-red-500 hover:bg-red-600 animate-pulse'
              : 'bg-brand-700 hover:bg-brand-800'
          }`}
        >
          {recording ? (
            <MicOff className="h-10 w-10 text-white" />
          ) : (
            <Mic className="h-10 w-10 text-white" />
          )}
        </button>

        <p className="mt-4 font-medium text-gray-900">
          {recording ? 'Recording… tap to stop' : 'Tap to record'}
        </p>
        <p className="text-sm text-gray-500 mt-1">
          Describe the job, customer, and any materials
        </p>
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-gray-50 px-2 text-gray-400">or upload file</span>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
      <button onClick={() => fileInputRef.current?.click()} className="btn-secondary w-full">
        <Upload className="h-4 w-4" />
        Upload audio file
      </button>
    </div>
  );
}

function ManualEntry({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const [jobType, setJobType] = useState('other');
  const [description, setDescription] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    setIsSubmitting(true);
    try {
      const { api } = await import('../lib/api.ts');
      const { data } = await api.post('/quotes', {
        jobType,
        jobDescription: description,
        customerName: customerName || undefined,
        lineItems: [],
      });
      navigate(`/quotes/${data.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>

      <div className="card p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Job Type</label>
          <select value={jobType} onChange={(e) => setJobType(e.target.value)} className="input">
            {Object.entries(JOB_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Job Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input min-h-[100px] resize-none"
            placeholder="Describe the work to be done…"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name</label>
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="input"
            placeholder="Optional"
          />
        </div>

        <button
          onClick={handleCreate}
          disabled={!description || isSubmitting}
          className="btn-primary w-full"
        >
          {isSubmitting ? 'Creating…' : 'Create Quote Draft'}
        </button>
      </div>
    </div>
  );
}

// ─── Subscription Limits ──────────────────────────────────────────────────────

export const SUBSCRIPTION_LIMITS = {
  free: {
    quotesPerMonth: 3,
    voiceTranscription: false,
    whatsappBot: false,
    pdfBranding: false,
  },
  starter: {
    quotesPerMonth: 30,
    voiceTranscription: true,
    whatsappBot: true,
    pdfBranding: true,
  },
  pro: {
    quotesPerMonth: Infinity,
    voiceTranscription: true,
    whatsappBot: true,
    pdfBranding: true,
  },
} as const;

// ─── Pricing Defaults ─────────────────────────────────────────────────────────

export const DEFAULT_LABOUR_RATE_PENCE = 4500; // £45/hr
export const DEFAULT_MARKUP_PCT = 20;
export const DEFAULT_VAT_RATE = 20;
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;
export const DEFAULT_PAYMENT_TERMS_DAYS = 14;

// ─── Job Types ────────────────────────────────────────────────────────────────

export const JOB_TYPE_LABELS: Record<string, string> = {
  consumer_unit_replacement: 'Consumer Unit Replacement',
  socket_installation: 'Socket Installation',
  light_installation: 'Light Fitting / Installation',
  rewire_full: 'Full Rewire',
  rewire_partial: 'Partial Rewire',
  ev_charger: 'EV Charger Installation',
  outdoor_lighting: 'Outdoor / Security Lighting',
  fault_finding: 'Fault Finding',
  pat_testing: 'PAT Testing',
  eicr: 'EICR (Electrical Installation Condition Report)',
  other: 'Other',
};

// ─── Quote Number Prefix ──────────────────────────────────────────────────────

export const QUOTE_NUMBER_PREFIX = 'QB';

// ─── WhatsApp TTL ──────────────────────────────────────────────────────────────

export const WHATSAPP_SESSION_TTL_SECONDS = 86400; // 24 hours

// ─── File Upload ──────────────────────────────────────────────────────────────

export const MAX_VOICE_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB
export const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
];

// ─── Units ─────────────────────────────────────────────────────────────────────

export const LINE_ITEM_UNITS = ['each', 'hour', 'm', 'm²', 'lot', 'day'] as const;
export type LineItemUnit = (typeof LINE_ITEM_UNITS)[number];

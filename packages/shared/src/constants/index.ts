// ─── Plan Limits ─────────────────────────────────────────────────────────────

export const PLAN_LIMITS = {
  trial: {
    quotesPerMonth: 5,
    jobLibraryEntries: 10,
    whatsappBot: true,
    pdfGeneration: true,
  },
  starter: {
    quotesPerMonth: 50,
    jobLibraryEntries: 50,
    whatsappBot: true,
    pdfGeneration: true,
  },
  pro: {
    quotesPerMonth: Infinity,
    jobLibraryEntries: Infinity,
    whatsappBot: true,
    pdfGeneration: true,
  },
} as const;

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_VAT_RATE = 0.20;
export const DEFAULT_LABOUR_RATE = 45;        // £/hr
export const DEFAULT_MARKUP_PERCENT = 20;
export const DEFAULT_DEPOSIT_PERCENT = 25;
export const DEFAULT_CALL_OUT_FEE = 0;
export const DEFAULT_TRAVEL_RATE_PER_MILE = 0.45;

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

export const WHATSAPP_SESSION_TTL_SECONDS = 86400; // 24 hours
export const WHATSAPP_SESSION_PREFIX = 'wa:session:';

// ─── File Limits ──────────────────────────────────────────────────────────────

export const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
];

// ─── UK Trades ────────────────────────────────────────────────────────────────

export const UK_TRADES = [
  'Electrician',
  'Plumber',
  'Gas Engineer',
  'Builder',
  'Carpenter',
  'Painter & Decorator',
  'Tiler',
  'Roofer',
  'HVAC Engineer',
  'Handyman',
  'Other',
] as const;

export type UKTrade = (typeof UK_TRADES)[number];

// ─── Job Keys (default library for electricians) ──────────────────────────────

export const DEFAULT_ELECTRICIAN_JOBS = [
  { jobKey: 'consumer_unit_replacement', label: 'Consumer Unit Replacement', labourHours: 4 },
  { jobKey: 'socket_single',             label: 'Single Socket Outlet',       labourHours: 0.5 },
  { jobKey: 'socket_double',             label: 'Double Socket Outlet',       labourHours: 0.75 },
  { jobKey: 'light_fitting',             label: 'Light Fitting Installation', labourHours: 0.5 },
  { jobKey: 'downlight_single',          label: 'Downlight (per unit)',       labourHours: 0.5 },
  { jobKey: 'rewire_full',               label: 'Full Rewire (3-bed house)',   labourHours: 40 },
  { jobKey: 'rewire_partial',            label: 'Partial Rewire',             labourHours: 8 },
  { jobKey: 'ev_charger',               label: 'EV Charger Installation',    labourHours: 3 },
  { jobKey: 'outdoor_lighting',          label: 'Outdoor Security Lighting',  labourHours: 2 },
  { jobKey: 'fault_finding',             label: 'Fault Finding',              labourHours: 1 },
  { jobKey: 'eicr',                      label: 'EICR Inspection',            labourHours: 3 },
  { jobKey: 'pat_testing',               label: 'PAT Testing (per item)',      labourHours: 0.1 },
] as const;

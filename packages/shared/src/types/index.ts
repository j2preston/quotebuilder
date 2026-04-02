// ─── Trader ───────────────────────────────────────────────────────────────────

export type SubscriptionTier = 'free' | 'starter' | 'pro';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';

export interface Trader {
  id: string;
  email: string;
  fullName: string;
  businessName: string;
  phone: string;
  vatNumber?: string;
  logoUrl?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  postcode: string;
  defaultVatRate: number; // e.g. 20 for 20%
  defaultMarkup: number;  // percentage over material cost
  quoteValidityDays: number;
  paymentTermsDays: number;
  quoteFooterText?: string;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  whatsappNumber?: string;
  quotesUsedThisMonth: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Customer ─────────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  traderId: string;
  name: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postcode?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Quote ────────────────────────────────────────────────────────────────────

export type QuoteStatus =
  | 'draft'
  | 'pending_review'
  | 'ready'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'declined'
  | 'expired';

export type JobType =
  | 'consumer_unit_replacement'
  | 'socket_installation'
  | 'light_installation'
  | 'rewire_full'
  | 'rewire_partial'
  | 'ev_charger'
  | 'outdoor_lighting'
  | 'fault_finding'
  | 'pat_testing'
  | 'eicr'
  | 'other';

export interface QuoteLineItem {
  id: string;
  quoteId: string;
  sortOrder: number;
  description: string;
  quantity: number;
  unit: string;           // 'each', 'hour', 'm', 'lot'
  unitCostPence: number;  // material/subcontract cost
  markupPct: number;      // percentage markup on cost
  labourMinutes: number;  // labour time for this item
  labourRatePence: number; // pence per hour
  lineNetPence: number;   // computed: (cost * (1 + markup/100)) + labour
  createdAt: Date;
}

export interface Quote {
  id: string;
  traderId: string;
  customerId?: string;
  customer?: Customer;
  lineItems: QuoteLineItem[];
  status: QuoteStatus;
  jobType: JobType;
  jobDescription: string;    // AI-extracted summary
  jobAddress?: string;
  internalNotes?: string;
  aiRawTranscript?: string;  // original Whisper transcript
  aiExtractedData?: AiExtractedJob; // what Claude pulled out

  // Pricing (all pence, computed by pricing engine)
  subtotalNetPence: number;
  vatPct: number;
  vatAmountPence: number;
  totalGrossPence: number;

  // Quote meta
  quoteNumber: string;       // e.g. QB-2024-0042
  validUntil?: Date;
  sentAt?: Date;
  viewedAt?: Date;
  acceptedAt?: Date;
  declinedAt?: Date;
  stripePaymentLinkUrl?: string;
  pdfUrl?: string;

  createdAt: Date;
  updatedAt: Date;
}

// ─── AI Extraction ─────────────────────────────────────────────────────────────

export interface AiExtractedLineItem {
  description: string;
  quantity: number;
  unit: string;
  estimatedMaterialCostPence?: number;
  labourMinutes?: number;
  notes?: string;
}

export interface AiExtractedJob {
  jobType: JobType;
  summary: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  jobAddress?: string;
  lineItems: AiExtractedLineItem[];
  suggestedValidityDays?: number;
  urgency?: 'normal' | 'urgent' | 'emergency';
  confidence: number; // 0-1
  clarificationNeeded?: string[]; // questions to ask trader
}

// ─── WhatsApp Session ─────────────────────────────────────────────────────────

export type WhatsAppState =
  | 'idle'
  | 'awaiting_voice'
  | 'processing'
  | 'confirming'
  | 'done';

export interface WhatsAppSession {
  traderId: string;
  state: WhatsAppState;
  quoteId?: string;
  lastMessageAt: number; // unix ms
  messageHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// ─── API Request/Response ──────────────────────────────────────────────────────

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Auth
export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
  businessName: string;
  phone: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  trader: Omit<Trader, 'createdAt' | 'updatedAt'>;
}

// Quote creation
export interface CreateQuoteFromVoiceRequest {
  audioFileKey: string; // Azure blob key
}

export interface CreateQuoteManualRequest {
  customerId?: string;
  customerName?: string;
  jobType: JobType;
  jobDescription: string;
  jobAddress?: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unit: string;
    unitCostPence: number;
    markupPct: number;
    labourMinutes: number;
    labourRatePence: number;
  }>;
  vatPct?: number;
}

export interface UpdateQuoteRequest {
  status?: QuoteStatus;
  customerId?: string;
  customerName?: string;
  jobType?: JobType;
  jobDescription?: string;
  jobAddress?: string;
  internalNotes?: string;
  lineItems?: Array<{
    id?: string;
    sortOrder: number;
    description: string;
    quantity: number;
    unit: string;
    unitCostPence: number;
    markupPct: number;
    labourMinutes: number;
    labourRatePence: number;
  }>;
  vatPct?: number;
}

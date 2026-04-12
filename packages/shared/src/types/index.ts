// ─── Trader ───────────────────────────────────────────────────────────────────

export type Plan = 'trial' | 'starter' | 'pro';

export interface Trader {
  id: string;
  name: string;
  businessName: string;
  trade: string;
  location: string;
  email: string;
  whatsappNumber?: string | null;
  stripeCustomerId?: string | null;
  postcode?: string | null;
  plan: Plan;
  quotesUsedThisMonth?: number;
  onboardingComplete: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Rate Card ────────────────────────────────────────────────────────────────

export interface RateCard {
  id: string;
  traderId: string;
  labourRate: number;       // £/hr
  callOutFee: number;       // £
  travelRatePerMile: number; // £/mile
  markupPercent: number;    // e.g. 20 for 20%
  vatRegistered: boolean;
  vatRate: number;          // e.g. 0.20
  depositPercent: number;   // e.g. 25 for 25%
  minimumCharge: number;    // £ — 0 means no minimum
  updatedAt: Date;
}

// ─── Job Library ──────────────────────────────────────────────────────────────

export interface JobMaterial {
  id: string;
  jobLibraryId: string;
  item: string;
  cost: number; // £
}

export interface JobLibraryEntry {
  id: string;
  traderId: string;
  jobKey: string;
  label: string;
  labourHours: number;
  isCustom: boolean;
  active: boolean;
  materials: JobMaterial[];
  createdAt: Date;
}

// ─── Quote ────────────────────────────────────────────────────────────────────

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';

export interface QuoteLineItem {
  id: string;
  quoteId: string;
  description: string;
  qty: number;
  unitPrice: number; // £
  total: number;     // £
  sortOrder: number;
}

export interface Quote {
  id: string;
  traderId: string;
  customerName: string;
  customerWhatsapp: string;
  status: QuoteStatus;
  lineItems: QuoteLineItem[];
  subtotal: number;      // £ ex VAT
  vatAmount: number;     // £
  total: number;         // £ inc VAT
  depositAmount: number; // £
  pdfUrl?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Pricing Engine ───────────────────────────────────────────────────────────

export type PropertyType = 'house' | 'flat_ground' | 'flat_upper' | 'commercial' | 'new_build';
export type Urgency      = 'standard' | 'next_day' | 'same_day';

export interface PricingInput {
  jobKey:          string;
  propertyType:    PropertyType;
  urgency:         Urgency;
  distanceMiles:   number;
  complexityFlags: string[];  // e.g. ['older_property', 'no_existing_cable_run']
  customerName:    string;
  notes?:          string;
  includeCallOut:  boolean;
}

export interface PricingContext {
  rateCard:   RateCard;
  jobLibrary: JobLibraryEntry[];
}

export interface LineItem {
  description: string;
  qty:         number;
  unitPrice:   number;  // £
  total:       number;  // £
  sortOrder:   number;
}

export interface QuoteCalculation {
  lineItems:     LineItem[];
  subtotal:      number;  // £ ex VAT
  vatAmount:     number;  // £
  total:         number;  // £ inc VAT
  depositAmount: number;  // £
  warnings:      string[];
}

// ─── API Shapes ───────────────────────────────────────────────────────────────

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}

export interface CreateQuoteRequest {
  customerName: string;
  customerWhatsapp: string;
  notes?: string;
  lineItems: Array<{
    description: string;
    qty: number;
    unitPrice: number;
    sortOrder?: number;
  }>;
}

export interface UpdateQuoteRequest {
  status?: QuoteStatus;
  customerName?: string;
  customerWhatsapp?: string;
  notes?: string;
  lineItems?: Array<{
    id?: string;
    description: string;
    qty: number;
    unitPrice: number;
    sortOrder?: number;
  }>;
}

export interface AuthResponse {
  token: string;
  trader: Omit<Trader, 'createdAt' | 'updatedAt'>;
  rateCard: RateCard | null;
}

export interface UpdateRateCardRequest {
  labourRate?: number;
  callOutFee?: number;
  travelRatePerMile?: number;
  markupPercent?: number;
  vatRegistered?: boolean;
  vatRate?: number;
  depositPercent?: number;
  minimumCharge?: number;
}

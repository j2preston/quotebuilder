import type { QuoteLineItem } from '../types/index.js';

// ─── Money Formatting ─────────────────────────────────────────────────────────

export function penceToPounds(pence: number): string {
  return (pence / 100).toFixed(2);
}

export function formatGBP(pence: number): string {
  return `£${penceToPounds(pence)}`;
}

export function poundsToPrice(pounds: string | number): number {
  return Math.round(Number(pounds) * 100);
}

// ─── Pricing Engine ───────────────────────────────────────────────────────────
// Deterministic — no AI involved in price calculation

export interface LineItemCalcInput {
  quantity: number;
  unitCostPence: number;
  markupPct: number;
  labourMinutes: number;
  labourRatePence: number; // per hour
}

export function calcLineItemNet(item: LineItemCalcInput): number {
  const materialNet = item.quantity * item.unitCostPence * (1 + item.markupPct / 100);
  const labourNet = (item.labourMinutes / 60) * item.labourRatePence;
  return Math.round(materialNet + labourNet);
}

export interface QuoteTotalsInput {
  lineItems: LineItemCalcInput[];
  vatPct: number;
}

export interface QuoteTotals {
  subtotalNetPence: number;
  vatAmountPence: number;
  totalGrossPence: number;
}

export function calcQuoteTotals(input: QuoteTotalsInput): QuoteTotals {
  const subtotalNetPence = input.lineItems.reduce(
    (sum, item) => sum + calcLineItemNet(item),
    0
  );
  const vatAmountPence = Math.round(subtotalNetPence * (input.vatPct / 100));
  const totalGrossPence = subtotalNetPence + vatAmountPence;
  return { subtotalNetPence, vatAmountPence, totalGrossPence };
}

// ─── Quote Numbers ────────────────────────────────────────────────────────────

export function generateQuoteNumber(prefix: string, sequence: number): string {
  const year = new Date().getFullYear();
  const seq = String(sequence).padStart(4, '0');
  return `${prefix}-${year}-${seq}`;
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function isValidUKPostcode(postcode: string): boolean {
  return /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(postcode.trim());
}

export function isValidUKPhone(phone: string): boolean {
  return /^(\+44|0)[1-9]\d{8,9}$/.test(phone.replace(/\s/g, ''));
}

export function isValidUKVAT(vat: string): boolean {
  return /^GB\d{9}(\d{3})?$/.test(vat.replace(/\s/g, ''));
}

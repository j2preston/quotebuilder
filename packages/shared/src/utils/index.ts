import type { RateCard, QuoteLineItem } from '../types/index.js';

// ─── Money ────────────────────────────────────────────────────────────────────

export function formatGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Pricing Engine ───────────────────────────────────────────────────────────
// Deterministic — no AI in price calculation.

export interface LineItemInput {
  qty: number;
  unitPrice: number; // £ (already marked-up by caller if applicable)
}

export function calcLineTotal(item: LineItemInput): number {
  return roundMoney(item.qty * item.unitPrice);
}

export interface QuoteTotalsInput {
  lineItems: LineItemInput[];
  rateCard: Pick<RateCard, 'vatRegistered' | 'vatRate' | 'depositPercent'>;
}

export interface QuoteTotals {
  subtotal: number;
  vatAmount: number;
  total: number;
  depositAmount: number;
}

export function calcQuoteTotals(input: QuoteTotalsInput): QuoteTotals {
  const subtotal = roundMoney(
    input.lineItems.reduce((s, li) => s + calcLineTotal(li), 0)
  );
  const vatAmount = input.rateCard.vatRegistered
    ? roundMoney(subtotal * input.rateCard.vatRate)
    : 0;
  const total = roundMoney(subtotal + vatAmount);
  const depositAmount = roundMoney(total * (input.rateCard.depositPercent / 100));
  return { subtotal, vatAmount, total, depositAmount };
}

/**
 * Apply markup to a raw material cost.
 * e.g. cost=100, markupPercent=20 → 120
 */
export function applyMarkup(cost: number, markupPercent: number): number {
  return roundMoney(cost * (1 + markupPercent / 100));
}

/**
 * Calculate the charge for labour hours at the trader's labour rate.
 */
export function calcLabourCharge(hours: number, labourRate: number): number {
  return roundMoney(hours * labourRate);
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function isValidUKPhone(phone: string): boolean {
  return /^(\+44|0)[1-9]\d{8,9}$/.test(phone.replace(/\s/g, ''));
}

export function isValidUKPostcode(postcode: string): boolean {
  return /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(postcode.trim());
}

// ─── WhatsApp number normalisation ────────────────────────────────────────────

/** Normalise to E.164 format: +447700900000 */
export function normaliseWhatsApp(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('44')) return `+${digits}`;
  if (digits.startsWith('0')) return `+44${digits.slice(1)}`;
  return `+${digits}`;
}

/** Strip leading + for Twilio's "whatsapp:+44..." format */
export function toTwilioNumber(e164: string): string {
  return `whatsapp:${e164}`;
}

export function fromTwilioNumber(twilio: string): string {
  return twilio.replace('whatsapp:', '');
}

// ─── Dates ────────────────────────────────────────────────────────────────────

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

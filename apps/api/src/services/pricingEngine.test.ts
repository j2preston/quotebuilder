/**
 * Pricing engine unit tests — Node built-in test runner (node:test).
 * Run: npm test -w apps/api
 *
 * All monetary assertions are exact (rounded to 2dp) so floating-point drift
 * is caught immediately if the rounding logic changes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote } from './pricingEngine.js';
import type { PricingContext, PricingInput, RateCard, JobLibraryEntry } from '@quotebot/shared';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

/** Standard VAT-registered rate card. */
const BASE_RATE_CARD: RateCard = {
  id:                'rc-1',
  traderId:          'trader-1',
  labourRate:        45,      // £45/hr
  callOutFee:        45,      // £45 call-out
  travelRatePerMile: 0.45,    // £0.45/mile
  markupPercent:     20,      // 20% on materials
  vatRegistered:     true,
  vatRate:           0.20,
  depositPercent:    30,
  updatedAt:         new Date(),
};

/** Consumer unit replacement with two material lines (totals £152). */
const CU_JOB: JobLibraryEntry = {
  id:          'job-1',
  traderId:    'trader-1',
  jobKey:      'consumer_unit_replacement',
  label:       'Consumer Unit Replacement',
  labourHours: 4,
  isCustom:    false,
  active:      true,
  materials: [
    { id: 'm-1', jobLibraryId: 'job-1', item: 'Consumer unit (18-way)', cost: 95 },
    { id: 'm-2', jobLibraryId: 'job-1', item: 'MCBs (set)',             cost: 45 },
    { id: 'm-3', jobLibraryId: 'job-1', item: 'Cable clips & sundries', cost: 12 },
  ],
  createdAt: new Date(),
};

/** Socket job with no materials (pure labour). */
const SOCKET_JOB: JobLibraryEntry = {
  id:          'job-2',
  traderId:    'trader-1',
  jobKey:      'socket_double',
  label:       'Double Socket Outlet',
  labourHours: 0.75,
  isCustom:    false,
  active:      true,
  materials:   [],
  createdAt:   new Date(),
};

const BASE_CONTEXT: PricingContext = {
  rateCard:   BASE_RATE_CARD,
  jobLibrary: [CU_JOB, SOCKET_JOB],
};

const BASE_INPUT: PricingInput = {
  jobKey:          'consumer_unit_replacement',
  propertyType:    'house',
  urgency:         'standard',
  distanceMiles:   0,
  complexityFlags: [],
  customerName:    'Jane Smith',
  includeCallOut:  false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function totalOfLineItems(result: ReturnType<typeof calculateQuote>): number {
  return result.lineItems.reduce((s, li) => s + li.total, 0);
}

function findLine(result: ReturnType<typeof calculateQuote>, descFragment: string) {
  return result.lineItems.find((li) =>
    li.description.toLowerCase().includes(descFragment.toLowerCase()),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('calculateQuote', () => {

  // ── 1. Standard house job ──────────────────────────────────────────────────
  describe('standard house job, 10 miles, no call-out', () => {
    //
    // Labour:    4hrs × £45       = £180.00
    // Materials: £152 × 1.20      = £182.40
    // Travel:    10mi × £0.45     = £4.50
    // Subtotal:                     £366.90
    // VAT 20%:                      £73.38
    // Total:                        £440.28
    // Deposit 30%:                  £132.08
    //
    const result = calculateQuote(
      { ...BASE_INPUT, distanceMiles: 10 },
      BASE_CONTEXT,
    );

    it('returns no warnings', () => assert.deepEqual(result.warnings, []));

    it('labour line: qty=4, unitPrice=45, total=180', () => {
      const line = findLine(result, 'labour');
      assert.ok(line, 'Labour line missing');
      assert.equal(line.qty,       4);
      assert.equal(line.unitPrice, 45);
      assert.equal(line.total,     180);
    });

    it('materials line: markedUp £152 × 1.20 = £182.40', () => {
      const line = findLine(result, 'parts');
      assert.ok(line, 'Materials line missing');
      assert.equal(line.total, 182.40);
    });

    it('travel line: 10 × 0.45 = £4.50', () => {
      const line = findLine(result, 'travel');
      assert.ok(line, 'Travel line missing');
      assert.equal(line.qty,       10);
      assert.equal(line.unitPrice, 0.45);
      assert.equal(line.total,     4.50);
    });

    it('subtotal = £366.90', () => assert.equal(result.subtotal, 366.90));
    it('VAT 20% = £73.38',   () => assert.equal(result.vatAmount, 73.38));
    it('total = £440.28',     () => assert.equal(result.total, 440.28));
    it('deposit 30% = £132.08', () => assert.equal(result.depositAmount, 132.08));

    it('line item totals sum to subtotal', () =>
      assert.equal(Math.round(totalOfLineItems(result) * 100) / 100, result.subtotal));

    it('line items are in ascending sortOrder', () => {
      const orders = result.lineItems.map((li) => li.sortOrder);
      assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
    });
  });

  // ── 2. Same-day urgency (50% labour uplift) ────────────────────────────────
  describe('same-day urgent job, call-out included, 0 miles', () => {
    //
    // Effective rate: £45 × 1.50 = £67.50
    // Labour:   4hrs × £67.50    = £270.00
    // Materials: £152 × 1.20     = £182.40
    // Call-out:                    £45.00
    // Subtotal:                    £497.40
    // VAT 20%:                     £99.48
    // Total:                       £596.88
    // Deposit 30%:                 £179.06
    //
    const result = calculateQuote(
      { ...BASE_INPUT, urgency: 'same_day', includeCallOut: true },
      BASE_CONTEXT,
    );

    it('no warnings', () => assert.deepEqual(result.warnings, []));

    it('labour: effective rate £67.50, total £270', () => {
      const line = findLine(result, 'labour');
      assert.ok(line);
      assert.equal(line.unitPrice, 67.50);
      assert.equal(line.total,     270.00);
    });

    it('labour description includes "same-day"', () => {
      const line = findLine(result, 'labour');
      assert.ok(line?.description.includes('same-day'));
    });

    it('call-out line present: £45', () => {
      const line = findLine(result, 'call-out');
      assert.ok(line, 'Call-out line missing');
      assert.equal(line.total, 45);
    });

    it('no travel line (0 miles)', () => {
      assert.equal(findLine(result, 'travel'), undefined);
    });

    it('subtotal = £497.40', () => assert.equal(result.subtotal, 497.40));
    it('VAT = £99.48',       () => assert.equal(result.vatAmount, 99.48));
    it('total = £596.88',    () => assert.equal(result.total, 596.88));
    it('deposit = £179.06',  () => assert.equal(result.depositAmount, 179.06));
  });

  // ── 3. Next-day uplift ────────────────────────────────────────────────────
  describe('next-day urgency gives 25% labour uplift', () => {
    //
    // Effective rate: £45 × 1.25 = £56.25
    // Labour: 4 × £56.25         = £225.00
    //
    const result = calculateQuote(
      { ...BASE_INPUT, urgency: 'next_day' },
      BASE_CONTEXT,
    );

    it('effective rate = £56.25', () => {
      const line = findLine(result, 'labour');
      assert.ok(line);
      assert.equal(line.unitPrice, 56.25);
      assert.equal(line.total,     225.00);
    });
  });

  // ── 4. Commercial with complexity flags ───────────────────────────────────
  describe('commercial property with older_property + no_existing_cable_run', () => {
    //
    // Effective rate: £45 × 1.25 = £56.25
    // Labour:   4hrs × £56.25    = £225.00
    // Contingency (older_property):        0.5hrs × £45 = £22.50
    // Contingency (no_existing_cable_run): 1.0hrs × £45 = £45.00
    // Materials: £152 × 1.20              = £182.40
    // Travel:   5mi × £0.45               = £2.25
    // Call-out:                            £45.00
    // Subtotal:                            £522.15
    // VAT 20%:                             £104.43
    // Total:                               £626.58
    // Deposit 30%:                         £187.97
    //
    const result = calculateQuote(
      {
        ...BASE_INPUT,
        propertyType:    'commercial',
        complexityFlags: ['older_property', 'no_existing_cable_run'],
        distanceMiles:   5,
        includeCallOut:  true,
      },
      BASE_CONTEXT,
    );

    it('emits two complexity warnings in order', () => {
      assert.equal(result.warnings.length, 2);
      assert.ok(result.warnings[0].toLowerCase().includes('older property'));
      assert.ok(result.warnings[1].toLowerCase().includes('cable run'));
    });

    it('labour line at commercial rate: £225', () => {
      const line = findLine(result, 'labour');
      assert.ok(line);
      assert.equal(line.unitPrice, 56.25);
      assert.equal(line.total,     225);
    });

    it('older_property contingency: 0.5hrs × £45 = £22.50', () => {
      const line = findLine(result, 'older property');
      assert.ok(line, 'Older property contingency missing');
      assert.equal(line.qty,       0.5);
      assert.equal(line.unitPrice, 45);
      assert.equal(line.total,     22.50);
    });

    it('no_existing_cable_run contingency: 1hr × £45 = £45', () => {
      const line = findLine(result, 'cable run');
      assert.ok(line, 'Cable run contingency missing');
      assert.equal(line.qty,       1);
      assert.equal(line.unitPrice, 45);
      assert.equal(line.total,     45);
    });

    it('contingency uses BASE labour rate, not commercial-modified rate', () => {
      const line = findLine(result, 'older property');
      assert.ok(line);
      assert.equal(line.unitPrice, BASE_RATE_CARD.labourRate); // 45, not 56.25
    });

    it('subtotal = £522.15', () => assert.equal(result.subtotal, 522.15));
    it('VAT = £104.43',      () => assert.equal(result.vatAmount, 104.43));
    it('total = £626.58',    () => assert.equal(result.total, 626.58));
    it('deposit = £187.97',  () => assert.equal(result.depositAmount, 187.97));
  });

  // ── 5. Job not found in library ───────────────────────────────────────────
  describe('jobKey not in library', () => {
    const result = calculateQuote(
      { ...BASE_INPUT, jobKey: 'nonexistent_job' },
      BASE_CONTEXT,
    );

    it('returns empty lineItems', () => assert.equal(result.lineItems.length, 0));
    it('returns the manual review warning', () =>
      assert.ok(result.warnings[0]?.includes('manual review required')));
    it('all totals are zero', () => {
      assert.equal(result.subtotal,      0);
      assert.equal(result.vatAmount,     0);
      assert.equal(result.total,         0);
      assert.equal(result.depositAmount, 0);
    });
  });

  // ── 6. Inactive job in library not matched ────────────────────────────────
  describe('jobKey exists but is inactive', () => {
    const inactiveJob: JobLibraryEntry = { ...CU_JOB, active: false };
    const result = calculateQuote(BASE_INPUT, {
      ...BASE_CONTEXT,
      jobLibrary: [inactiveJob],
    });

    it('treats inactive job as not found', () =>
      assert.ok(result.warnings[0]?.includes('manual review required')));
  });

  // ── 7. Zero distance — no travel line ────────────────────────────────────
  describe('zero distanceMiles', () => {
    //
    // Labour:    4 × £45     = £180.00
    // Materials: £152 × 1.20 = £182.40
    // Subtotal:               £362.40
    // VAT 20%:                £72.48
    // Total:                  £434.88
    // Deposit 30%:            £130.46
    //
    const result = calculateQuote(BASE_INPUT, BASE_CONTEXT); // distanceMiles: 0 already

    it('no travel line item', () =>
      assert.equal(findLine(result, 'travel'), undefined));

    it('subtotal = £362.40', () => assert.equal(result.subtotal, 362.40));
    it('VAT = £72.48',       () => assert.equal(result.vatAmount, 72.48));
    it('total = £434.88',    () => assert.equal(result.total, 434.88));
    it('deposit = £130.46',  () => assert.equal(result.depositAmount, 130.46));
  });

  // ── 8. Non-VAT-registered trader ─────────────────────────────────────────
  describe('non-VAT-registered trader', () => {
    //
    // Labour:    4 × £45     = £180.00
    // Materials: £152 × 1.20 = £182.40
    // Travel:    10 × £0.45  = £4.50
    // Subtotal:               £366.90
    // VAT:                    £0.00   ← not registered
    // Total:                  £366.90
    // Deposit 30%:            £110.07
    //
    const nonVatContext: PricingContext = {
      ...BASE_CONTEXT,
      rateCard: { ...BASE_RATE_CARD, vatRegistered: false },
    };
    const result = calculateQuote(
      { ...BASE_INPUT, distanceMiles: 10 },
      nonVatContext,
    );

    it('vatAmount is exactly 0', () => assert.equal(result.vatAmount, 0));
    it('total equals subtotal',   () => assert.equal(result.total, result.subtotal));
    it('subtotal = £366.90',      () => assert.equal(result.subtotal, 366.90));
    it('total = £366.90',         () => assert.equal(result.total, 366.90));
    it('deposit 30% of total = £110.07', () =>
      assert.equal(result.depositAmount, 110.07));
  });

  // ── 9. No materials job (pure labour) ────────────────────────────────────
  describe('job with no materials', () => {
    const result = calculateQuote(
      { ...BASE_INPUT, jobKey: 'socket_double' },
      BASE_CONTEXT,
    );

    it('no Parts & Materials line', () =>
      assert.equal(findLine(result, 'parts'), undefined));

    it('labour: 0.75hrs × £45 = £33.75', () => {
      const line = findLine(result, 'labour');
      assert.ok(line);
      assert.equal(line.qty,       0.75);
      assert.equal(line.unitPrice, 45);
      assert.equal(line.total,     33.75);
    });

    it('subtotal = £33.75', () => assert.equal(result.subtotal, 33.75));
  });

  // ── 10. New build discount (−10% labour) ─────────────────────────────────
  describe('new_build property type gives 10% labour discount', () => {
    //
    // Effective rate: £45 × 0.90 = £40.50
    // Labour: 4 × £40.50         = £162.00
    //
    const result = calculateQuote(
      { ...BASE_INPUT, propertyType: 'new_build' },
      BASE_CONTEXT,
    );

    it('effective rate = £40.50', () => {
      const line = findLine(result, 'labour');
      assert.ok(line);
      assert.equal(line.unitPrice, 40.50);
      assert.equal(line.total,     162.00);
    });
  });

  // ── 11. Unknown complexity flag is silently ignored ────────────────────────
  describe('unknown complexity flag', () => {
    const result = calculateQuote(
      { ...BASE_INPUT, complexityFlags: ['unknown_flag', 'another_unknown'] },
      BASE_CONTEXT,
    );

    it('no warnings for unknown flags', () =>
      assert.equal(result.warnings.length, 0));

    it('no extra line items', () => {
      // Only labour + materials (no travel, no call-out, no contingency)
      assert.equal(result.lineItems.length, 2);
    });
  });

  // ── 12. Call-out suppressed when includeCallOut = false ───────────────────
  describe('includeCallOut = false', () => {
    const result = calculateQuote(
      { ...BASE_INPUT, includeCallOut: false },
      BASE_CONTEXT,
    );

    it('no call-out line', () =>
      assert.equal(findLine(result, 'call-out'), undefined));
  });

  // ── 13. Call-out with zero fee does not produce a £0 line ─────────────────
  describe('callOutFee = 0 even when includeCallOut = true', () => {
    const zeroFeeContext: PricingContext = {
      ...BASE_CONTEXT,
      rateCard: { ...BASE_RATE_CARD, callOutFee: 0 },
    };
    const result = calculateQuote(
      { ...BASE_INPUT, includeCallOut: true },
      zeroFeeContext,
    );

    it('no call-out line for zero fee', () =>
      assert.equal(findLine(result, 'call-out'), undefined));
  });

  // ── 14. Flat upper floor (+15% labour) ───────────────────────────────────
  describe('flat_upper property type gives 15% labour uplift', () => {
    //
    // Effective rate: £45 × 1.15 = £51.75
    // Labour: 4 × £51.75         = £207.00
    //
    const result = calculateQuote(
      { ...BASE_INPUT, propertyType: 'flat_upper' },
      BASE_CONTEXT,
    );

    it('effective rate = £51.75', () => {
      const line = findLine(result, 'labour');
      assert.ok(line);
      assert.equal(line.unitPrice, 51.75);
      assert.equal(line.total,     207.00);
    });
  });
});

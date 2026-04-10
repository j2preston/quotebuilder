import { roundMoney } from '@quotebot/shared';
import type {
  PricingInput,
  PricingContext,
  QuoteCalculation,
  LineItem,
  PropertyType,
  Urgency,
} from '@quotebot/shared';

// ─── Modifier tables ──────────────────────────────────────────────────────────

const PROPERTY_MULTIPLIERS: Record<PropertyType, number> = {
  house:       1.00,
  flat_ground: 1.00,
  flat_upper:  1.15,
  commercial:  1.25,
  new_build:   0.90,
};

const URGENCY_MULTIPLIERS: Record<Urgency, number> = {
  standard: 1.00,
  next_day: 1.25,
  same_day: 1.50,
};

// Complexity flags that add contingency hours at the BASE labour rate.
// Unknown flags are silently ignored so new flags added later don't break old quotes.
const COMPLEXITY: Record<string, { hours: number; warning: string }> = {
  older_property:        { hours: 0.5, warning: 'Older property: 30min contingency added' },
  no_existing_cable_run: { hours: 1.0, warning: 'No existing cable run: 1hr contingency added' },
  multiple_floors:       { hours: 1.0, warning: 'Multiple floors: 1hr contingency added' },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Deterministic pricing engine.
 * No external calls, no randomness — same input always produces same output.
 */
export function calculateQuote(
  input: PricingInput,
  context: PricingContext,
): QuoteCalculation {
  const { rateCard, jobLibrary } = context;

  // 1. Job lookup
  const job = jobLibrary.find((j) => j.jobKey === input.jobKey && j.active);
  if (!job) {
    return {
      lineItems:     [],
      subtotal:      0,
      vatAmount:     0,
      total:         0,
      depositAmount: 0,
      warnings:      ['Job not in library — manual review required'],
    };
  }

  const lineItems: LineItem[] = [];
  const warnings:  string[]   = [];
  let   sortOrder              = 0;

  // 2 + 3 + 4. Base labour × property modifier × urgency modifier
  const propertyMult  = PROPERTY_MULTIPLIERS[input.propertyType];
  const urgencyMult   = URGENCY_MULTIPLIERS[input.urgency];
  const effectiveRate = roundMoney(rateCard.labourRate * propertyMult * urgencyMult);
  const labourTotal   = roundMoney(job.labourHours * effectiveRate);

  lineItems.push({
    description: buildLabourDescription(job.label, input.propertyType, input.urgency),
    qty:         job.labourHours,
    unitPrice:   effectiveRate,
    total:       labourTotal,
    sortOrder:   sortOrder++,
  });

  // 5. Complexity flags — each adds hours at the BASE labour rate (not modified)
  for (const flag of input.complexityFlags) {
    const entry = COMPLEXITY[flag];
    if (!entry) continue;

    const contingencyTotal = roundMoney(entry.hours * rateCard.labourRate);
    lineItems.push({
      description: `Contingency – ${flagLabel(flag)} (${entry.hours}hr${entry.hours !== 1 ? 's' : ''})`,
      qty:         entry.hours,
      unitPrice:   rateCard.labourRate,
      total:       contingencyTotal,
      sortOrder:   sortOrder++,
    });
    warnings.push(entry.warning);
  }

  // 6. Materials — marked up, collapsed to a single line
  if (job.materials.length > 0) {
    const rawTotal     = job.materials.reduce((s, m) => s + m.cost, 0);
    const markedUpTotal = roundMoney(rawTotal * (1 + rateCard.markupPercent / 100));
    lineItems.push({
      description: 'Parts & Materials',
      qty:         1,
      unitPrice:   markedUpTotal,
      total:       markedUpTotal,
      sortOrder:   sortOrder++,
    });
  }

  // 7. Travel — only when distance > 0
  if (input.distanceMiles > 0) {
    const travelTotal = roundMoney(input.distanceMiles * rateCard.travelRatePerMile);
    lineItems.push({
      description: `Travel (${input.distanceMiles} mile${input.distanceMiles !== 1 ? 's' : ''})`,
      qty:         input.distanceMiles,
      unitPrice:   rateCard.travelRatePerMile,
      total:       travelTotal,
      sortOrder:   sortOrder++,
    });
  }

  // 8. Call-out fee
  if (input.includeCallOut && rateCard.callOutFee > 0) {
    lineItems.push({
      description: 'Call-out fee',
      qty:         1,
      unitPrice:   rateCard.callOutFee,
      total:       rateCard.callOutFee,
      sortOrder:   sortOrder++,
    });
  }

  // 9. Minimum charge — add a top-up line if total labour + materials falls below the floor
  const provisionalSubtotal = roundMoney(lineItems.reduce((s, li) => s + li.total, 0));
  if (rateCard.minimumCharge > 0 && provisionalSubtotal < rateCard.minimumCharge) {
    const topUp = roundMoney(rateCard.minimumCharge - provisionalSubtotal);
    lineItems.push({
      description: 'Minimum job charge',
      qty:         1,
      unitPrice:   topUp,
      total:       topUp,
      sortOrder:   sortOrder++,
    });
  }

  // 10. Totals
  const subtotal      = roundMoney(lineItems.reduce((s, li) => s + li.total, 0));
  const vatAmount     = rateCard.vatRegistered
    ? roundMoney(subtotal * rateCard.vatRate)
    : 0;
  const total         = roundMoney(subtotal + vatAmount);
  const depositAmount = roundMoney(total * (rateCard.depositPercent / 100));

  return { lineItems, subtotal, vatAmount, total, depositAmount, warnings };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function buildLabourDescription(
  jobLabel:     string,
  propertyType: PropertyType,
  urgency:      Urgency,
): string {
  const qualifiers: string[] = [];
  if (urgency === 'same_day') qualifiers.push('same-day');
  if (urgency === 'next_day') qualifiers.push('next-day');
  if (propertyType === 'commercial') qualifiers.push('commercial rate');
  if (propertyType === 'flat_upper') qualifiers.push('upper-floor flat');
  if (propertyType === 'new_build')  qualifiers.push('new build');

  return qualifiers.length > 0
    ? `Labour – ${jobLabel} (${qualifiers.join(', ')})`
    : `Labour – ${jobLabel}`;
}

/** 'no_existing_cable_run' → 'No Existing Cable Run' */
function flagLabel(flag: string): string {
  return flag
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

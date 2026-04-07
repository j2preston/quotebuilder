import Anthropic from '@anthropic-ai/sdk';
import type { Pool } from 'pg';
import { calculateQuote } from './pricingEngine.js';
import type {
  RateCard,
  JobLibraryEntry,
  PricingInput,
  PropertyType,
  Urgency,
} from '@quotebot/shared';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-6';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractedFields {
  jobKey: string;
  propertyType: string;
  urgency: string;
  distanceMiles: number;
  complexityFlags: string[];
  customerName: string;
  notes: string;
  includeCallOut: boolean;
  confidence: 'high' | 'medium' | 'low';
  clarificationNeeded: string | null;
}

interface AssemblyResult {
  jobDescription: string;
  lineItemLabels: string[];
}

export type QuoteResult =
  | { status: 'needs_clarification'; question: string }
  | { status: 'manual_review'; warning: string }
  | { status: 'ready'; quoteId: string };

// ─── Row mappers (local — avoids circular import with traders route) ──────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRateCard(row: any): RateCard {
  return {
    id:                row.id,
    traderId:          row.trader_id,
    labourRate:        Number(row.labour_rate),
    callOutFee:        Number(row.call_out_fee),
    travelRatePerMile: Number(row.travel_rate_per_mile),
    markupPercent:     Number(row.markup_percent),
    vatRegistered:     row.vat_registered,
    vatRate:           Number(row.vat_rate),
    depositPercent:    Number(row.deposit_percent),
    updatedAt:         row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJobEntry(row: any, materials: any[]): JobLibraryEntry {
  return {
    id:          row.id,
    traderId:    row.trader_id,
    jobKey:      row.job_key,
    label:       row.label,
    labourHours: Number(row.labour_hours),
    isCustom:    row.is_custom,
    active:      row.active,
    createdAt:   row.created_at,
    materials: materials.map((m) => ({
      id:           m.id,
      jobLibraryId: m.job_library_id,
      item:         m.item,
      cost:         Number(m.cost),
    })),
  };
}

// ─── Anthropic client (singleton per process) ─────────────────────────────────

const anthropic = new Anthropic();

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateQuote(
  transcript: string,
  traderId: string,
  db: Pool,
): Promise<QuoteResult> {
  // 1. Load trader context, rate card, and job library in parallel
  const [traderRes, rcRes, libraryRes] = await Promise.all([
    db.query('SELECT name, trade, location FROM traders WHERE id = $1', [traderId]),
    db.query('SELECT * FROM rate_cards WHERE trader_id = $1', [traderId]),
    db.query(
      'SELECT * FROM job_library WHERE trader_id = $1 AND active = true ORDER BY job_key',
      [traderId],
    ),
  ]);

  const trader = traderRes.rows[0];
  const rcRow  = rcRes.rows[0];
  if (!trader || !rcRow) {
    return { status: 'manual_review', warning: 'Trader or rate card not configured' };
  }

  const rateCard = rowToRateCard(rcRow);

  // Batch-fetch materials for all job library entries
  const libEntryIds = libraryRes.rows.map((r) => r.id);
  const matsRes     = libEntryIds.length > 0
    ? await db.query(
        'SELECT * FROM job_materials WHERE job_library_id = ANY($1::uuid[])',
        [libEntryIds],
      )
    : { rows: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matsByEntry: Record<string, any[]> = {};
  for (const mat of matsRes.rows) {
    (matsByEntry[mat.job_library_id] ??= []).push(mat);
  }

  const jobLibrary: JobLibraryEntry[] = libraryRes.rows.map((row) =>
    rowToJobEntry(row, matsByEntry[row.id] ?? []),
  );

  // 2. Call 1 — extract structured fields from transcript
  const jobKeyList = jobLibrary.length > 0
    ? jobLibrary.map((j) => j.jobKey).join(', ')
    : '(no jobs configured)';

  const extractionSystem =
    `You are a quoting assistant for ${trader.name}, a ${trader.trade} based in ${trader.location}.\n\n` +
    `Your job is to extract structured information from a job description to generate a quote.\n\n` +
    `Extract the following fields and respond with ONLY valid JSON, no other text:\n` +
    `{\n` +
    `  "jobKey": string,           // closest match from: ${jobKeyList}\n` +
    `  "propertyType": string,     // one of: house, flat_ground, flat_upper, commercial, new_build\n` +
    `  "urgency": string,          // one of: standard, next_day, same_day\n` +
    `  "distanceMiles": number,    // estimate from location if mentioned, default 0\n` +
    `  "complexityFlags": string[], // from: older_property, no_existing_cable_run, multiple_floors\n` +
    `  "customerName": string,     // extract if mentioned, else ""\n` +
    `  "notes": string,            // any other relevant details\n` +
    `  "includeCallOut": boolean,  // true if this is the first visit/attendance\n` +
    `  "confidence": "high" | "medium" | "low",\n` +
    `  "clarificationNeeded": string | null  // single question if critical info missing\n` +
    `}`;

  const extractionResponse = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 500,
    system:     extractionSystem,
    messages:   [{ role: 'user', content: transcript }],
  });

  const extractionText = extractionResponse.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let extracted: ExtractedFields;
  try {
    extracted = JSON.parse(extractionText);
  } catch {
    return {
      status:  'manual_review',
      warning: 'Could not parse job details from transcript — please create quote manually',
    };
  }

  // 3. Return clarification request if needed
  if (extracted.clarificationNeeded !== null && extracted.confidence === 'low') {
    return { status: 'needs_clarification', question: extracted.clarificationNeeded };
  }

  // 4. Run deterministic pricing engine
  const pricingInput: PricingInput = {
    jobKey:          String(extracted.jobKey ?? ''),
    propertyType:    (extracted.propertyType ?? 'house') as PropertyType,
    urgency:         (extracted.urgency ?? 'standard') as Urgency,
    distanceMiles:   Number(extracted.distanceMiles) || 0,
    complexityFlags: Array.isArray(extracted.complexityFlags) ? extracted.complexityFlags : [],
    customerName:    String(extracted.customerName ?? ''),
    notes:           extracted.notes || undefined,
    includeCallOut:  Boolean(extracted.includeCallOut),
  };

  const calculation = calculateQuote(pricingInput, { rateCard, jobLibrary });

  // 5. Job not in library — send for manual review
  if (calculation.lineItems.length === 0) {
    return {
      status:  'manual_review',
      warning: calculation.warnings[0] ?? 'Job not in library — manual review required',
    };
  }

  // 6. Call 2 — assemble professional job description and line item labels
  const assemblySystem =
    `You are writing a professional quote document for ${trader.name}.\n` +
    `Given the job details and calculated line items, write:\n` +
    `1. A one-sentence job description (professional, specific)\n` +
    `2. Improved line item descriptions (professional, specific — max 8 words each)\n\n` +
    `Respond with ONLY valid JSON:\n` +
    `{\n` +
    `  "jobDescription": string,\n` +
    `  "lineItemLabels": string[]  // same count and order as input line items\n` +
    `}`;

  const assemblyUserContent = JSON.stringify({
    extractedFields: {
      jobKey:       extracted.jobKey,
      propertyType: extracted.propertyType,
      urgency:      extracted.urgency,
      customerName: extracted.customerName,
      notes:        extracted.notes,
    },
    lineItems: calculation.lineItems.map((li) => ({
      description: li.description,
      qty:         li.qty,
      unitPrice:   li.unitPrice,
      total:       li.total,
    })),
  });

  const assemblyResponse = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 300,
    system:     assemblySystem,
    messages:   [{ role: 'user', content: assemblyUserContent }],
  });

  const assemblyText = assemblyResponse.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let assembled: AssemblyResult;
  try {
    assembled = JSON.parse(assemblyText);
  } catch {
    // Degrade gracefully — keep original descriptions
    assembled = {
      jobDescription: calculation.lineItems[0]?.description ?? extracted.jobKey,
      lineItemLabels: calculation.lineItems.map((li) => li.description),
    };
  }

  // Ensure label count matches; fall back to original description for any gap
  const labels = calculation.lineItems.map(
    (li, i) => assembled.lineItemLabels[i] ?? li.description,
  );

  // Build notes: job description + any additional notes from transcript
  const quoteNotes = [assembled.jobDescription, extracted.notes || '']
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n') || null;

  // 7. Insert quote + line items in a single transaction
  const pgClient = await db.connect();
  try {
    await pgClient.query('BEGIN');

    const insertQuote = await pgClient.query(
      `INSERT INTO quotes
         (trader_id, customer_name, customer_whatsapp, status,
          subtotal, vat_amount, total, deposit_amount, notes)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        traderId,
        extracted.customerName || '',
        '',                          // WhatsApp captured separately via Twilio webhook
        calculation.subtotal,
        calculation.vatAmount,
        calculation.total,
        calculation.depositAmount,
        quoteNotes,
      ],
    );

    const quoteId: string = insertQuote.rows[0].id;

    for (const [i, li] of calculation.lineItems.entries()) {
      await pgClient.query(
        `INSERT INTO quote_line_items (quote_id, description, qty, unit_price, total, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [quoteId, labels[i], li.qty, li.unitPrice, li.total, li.sortOrder],
      );
    }

    await pgClient.query('COMMIT');
    return { status: 'ready', quoteId };
  } catch (err) {
    await pgClient.query('ROLLBACK');
    throw err;
  } finally {
    pgClient.release();
  }
}

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

export interface ExtractedFields {
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

export interface AvailableJob {
  jobKey: string;
  label: string;
}

export type ExtractionResult =
  | { status: 'needs_clarification'; question: string }
  | { status: 'extracted'; fields: ExtractedFields; availableJobs: AvailableJob[] };

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
    minimumCharge:     Number(row.minimum_charge ?? 0),
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

// ─── Step 1: Extract structured fields from transcript ────────────────────────

export async function extractQuoteFields(
  transcript: string,
  traderId: string,
  db: Pool,
): Promise<ExtractionResult> {
  // Load trader context and job library
  const [traderRes, libraryRes] = await Promise.all([
    db.query('SELECT name, trade, location FROM traders WHERE id = $1', [traderId]),
    db.query(
      'SELECT * FROM job_library WHERE trader_id = $1 AND active = true ORDER BY job_key',
      [traderId],
    ),
  ]);

  const trader = traderRes.rows[0];
  if (!trader) {
    return { status: 'needs_clarification', question: 'Trader account not found.' };
  }

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

  const jobList = jobLibrary.length > 0
    ? jobLibrary.map((j) => {
        const mats = j.materials.map((m) => m.item).join(',');
        return mats ? `${j.jobKey}|${j.label}|${mats}` : `${j.jobKey}|${j.label}`;
      }).join('\n')
    : '(none)';

  const extractionSystem =
    `${trader.name} (${trader.trade}, ${trader.location}). Return JSON only:\n` +
    `{\n` +
    `"jobKey":"",        // exact key from list below\n` +
    `"propertyType":"",  // house|flat_ground|flat_upper|commercial|new_build\n` +
    `"urgency":"",       // standard|next_day|same_day\n` +
    `"distanceMiles":0,  // 0 if not mentioned\n` +
    `"complexityFlags":[], // older_property|no_existing_cable_run|multiple_floors\n` +
    `"customerName":"",\n` +
    `"notes":"",\n` +
    `"includeCallOut":false, // true=first visit\n` +
    `"confidence":"",    // high|medium|low\n` +
    `"clarificationNeeded":null // or question string\n` +
    `}\n` +
    `Jobs (key|label|materials):\n` +
    jobList;

  const extractionResponse = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 300,
    system:     extractionSystem,
    messages:   [{ role: 'user', content: transcript }],
  });

  const extractionText = extractionResponse.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const extractionJson = extractionText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let extracted: ExtractedFields;
  try {
    extracted = JSON.parse(extractionJson);
  } catch {
    // Return a clarification rather than crashing
    return {
      status: 'needs_clarification',
      question: 'I couldn\'t understand the job details. Could you describe it again, including the job type, property, and customer name?',
    };
  }

  if (extracted.clarificationNeeded !== null && extracted.confidence === 'low') {
    return { status: 'needs_clarification', question: extracted.clarificationNeeded };
  }

  const availableJobs: AvailableJob[] = jobLibrary.map((j) => ({ jobKey: j.jobKey, label: j.label }));

  return { status: 'extracted', fields: extracted, availableJobs };
}

// ─── Step 2: Price + save a confirmed set of fields ───────────────────────────

export async function saveConfirmedQuote(
  fields: ExtractedFields,
  traderId: string,
  db: Pool,
): Promise<QuoteResult> {
  // Load rate card + job library (re-fetch from DB — don't trust client-side context)
  const [rcRes, libraryRes] = await Promise.all([
    db.query('SELECT * FROM rate_cards WHERE trader_id = $1', [traderId]),
    db.query(
      'SELECT * FROM job_library WHERE trader_id = $1 AND active = true ORDER BY job_key',
      [traderId],
    ),
  ]);

  const rcRow = rcRes.rows[0];
  if (!rcRow) {
    return { status: 'manual_review', warning: 'Rate card not configured' };
  }

  const rateCard = rowToRateCard(rcRow);

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

  const pricingInput: PricingInput = {
    jobKey:          String(fields.jobKey ?? ''),
    propertyType:    (fields.propertyType ?? 'house') as PropertyType,
    urgency:         (fields.urgency ?? 'standard') as Urgency,
    distanceMiles:   Number(fields.distanceMiles) || 0,
    complexityFlags: Array.isArray(fields.complexityFlags) ? fields.complexityFlags : [],
    customerName:    String(fields.customerName ?? ''),
    notes:           fields.notes || undefined,
    includeCallOut:  Boolean(fields.includeCallOut),
  };

  const calculation = calculateQuote(pricingInput, { rateCard, jobLibrary });

  if (calculation.lineItems.length === 0) {
    return {
      status:  'manual_review',
      warning: calculation.warnings[0] ?? 'Job not in library — manual review required',
    };
  }

  // Polish job description and line item labels via Claude
  const traderRes = await db.query('SELECT name FROM traders WHERE id = $1', [traderId]);
  const traderName = traderRes.rows[0]?.name ?? '';

  const assemblySystem =
    `Write a professional quote for ${traderName}. Return JSON only:\n` +
    `{"jobDescription":"","lineItemLabels":[]}\n` +
    `jobDescription: one professional sentence. lineItemLabels: one per item, max 8 words, same order.`;

  const assemblyUserContent = JSON.stringify({
    job:      jobLibrary.find((j) => j.jobKey === fields.jobKey)?.label ?? fields.jobKey,
    customer: fields.customerName || undefined,
    property: fields.propertyType,
    urgency:  fields.urgency,
    notes:    fields.notes || undefined,
    items:    calculation.lineItems.map((li) => li.description),
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
    .join('')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let assembled: AssemblyResult;
  try {
    assembled = JSON.parse(assemblyText);
  } catch {
    assembled = {
      jobDescription: buildJobDescription(
        jobLibrary.find((j) => j.jobKey === fields.jobKey)?.label ?? fields.jobKey,
        fields.customerName,
        pricingInput.propertyType,
        pricingInput.urgency,
      ),
      lineItemLabels: calculation.lineItems.map((li) => li.description),
    };
  }

  const labels    = calculation.lineItems.map((li, i) => assembled.lineItemLabels[i] ?? li.description);
  const quoteNotes = [assembled.jobDescription, fields.notes || '']
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n') || null;

  // Insert quote + line items in a single transaction
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
        fields.customerName || '',
        '',
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

    // Increment monthly usage counter (ignore if column doesn't exist)
    await pgClient.query(
      `UPDATE traders SET quotes_used_this_month = COALESCE(quotes_used_this_month, 0) + 1
       WHERE id = $1`,
      [traderId],
    ).catch(() => { /* column may not exist on older schema — non-fatal */ });

    await pgClient.query('COMMIT');
    return { status: 'ready', quoteId };
  } catch (err) {
    await pgClient.query('ROLLBACK');
    throw err;
  } finally {
    pgClient.release();
  }
}

// ─── Public API — single-call convenience wrapper ─────────────────────────────

export async function generateQuote(
  transcript: string,
  traderId: string,
  db: Pool,
): Promise<QuoteResult> {
  const extraction = await extractQuoteFields(transcript, traderId, db);
  if (extraction.status === 'needs_clarification') return extraction;
  return saveConfirmedQuote(extraction.fields, traderId, db);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildJobDescription(
  jobLabel:     string,
  customerName: string,
  propertyType: PropertyType,
  urgency:      Urgency,
): string {
  const parts = [jobLabel];
  if (customerName) parts.push(`for ${customerName}`);

  const propSuffix: Partial<Record<PropertyType, string>> = {
    flat_upper:  'upper-floor flat',
    commercial:  'commercial property',
    new_build:   'new build',
    flat_ground: 'ground-floor flat',
  };
  if (propSuffix[propertyType]) parts.push(`at ${propSuffix[propertyType]}`);
  if (urgency === 'same_day') parts.push('(same-day)');
  if (urgency === 'next_day') parts.push('(next day)');

  return parts.join(' ');
}

import type { Pool } from 'pg';
import { WHATSAPP_SESSION_TTL_SECONDS } from '@quotebot/shared';
import { extractQuoteFields, saveConfirmedQuote } from './quoteAI.js';
import type { ExtractedFields, AvailableJob } from './quoteAI.js';
import { generateQuotePdf } from './pdfGenerator.js';
import { uploadQuotePdf } from './blobStorage.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RedisLike {
  get(key: string): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface WhatsAppSession {
  traderId:       string;
  flow:           'customer' | 'trader';
  stage:          'awaiting_gaps' | 'generating';
  extracted:      Partial<ExtractedFields>;
  messageHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  createdAt:      number;
  round:          number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSION_PREFIX = 'session:';
const TTL            = WHATSAPP_SESSION_TTL_SECONDS;

const RESTART_KEYWORDS = new Set(['start', 'reset', 'restart', '/start']);

const PROPERTY_LABELS: Record<string, string> = {
  house:       'House',
  flat_ground: 'Ground floor flat',
  flat_upper:  'Upper floor flat',
  commercial:  'Commercial',
  new_build:   'New build',
};

const URGENCY_LABELS: Record<string, string> = {
  standard: 'Standard',
  next_day: 'Next day (priority)',
  same_day: 'Same day (urgent)',
};

// ─── Session CRUD ─────────────────────────────────────────────────────────────

export async function getSession(
  redis: RedisLike,
  whatsappNumber: string,
): Promise<WhatsAppSession | null> {
  const raw = await redis.get(`${SESSION_PREFIX}${whatsappNumber}`);
  return raw ? (JSON.parse(raw) as WhatsAppSession) : null;
}

export async function setSession(
  redis: RedisLike,
  whatsappNumber: string,
  session: WhatsAppSession,
): Promise<void> {
  await redis.setEx(`${SESSION_PREFIX}${whatsappNumber}`, TTL, JSON.stringify(session));
}

export async function deleteSession(
  redis: RedisLike,
  whatsappNumber: string,
): Promise<void> {
  await redis.del(`${SESSION_PREFIX}${whatsappNumber}`);
}

// ─── Structured summary builder ───────────────────────────────────────────────

interface SummaryResult {
  text: string;
  isComplete: boolean;  // job found + name present = can quote now
}

function buildStructuredSummary(
  fields: Partial<ExtractedFields>,
  availableJobs: AvailableJob[],
  traderName: string,
): SummaryResult {
  const lines: string[] = [];
  const missing: string[] = [];

  // Job type
  const job = availableJobs.find((j) => j.jobKey === fields.jobKey);
  if (job) {
    lines.push(`✅ Job: ${job.label}`);
  } else {
    lines.push(`❓ Job type: [what type of job do you need?]`);
    missing.push('job');
  }

  // Customer name
  if (fields.customerName) {
    lines.push(`✅ Your name: ${fields.customerName}`);
  } else {
    lines.push(`❓ Your name: [what's your first name?]`);
    missing.push('name');
  }

  // Property type — show current value but mark unknown if still at default
  const propLabel = PROPERTY_LABELS[fields.propertyType ?? 'house'];
  if (fields.propertyType && fields.propertyType !== 'house') {
    lines.push(`✅ Property: ${propLabel}`);
  } else {
    lines.push(`❓ Property: [house / flat / commercial / new build?]`);
    missing.push('property');
  }

  // Urgency — only confirm if explicitly non-standard
  if (fields.urgency && fields.urgency !== 'standard') {
    lines.push(`✅ Timing: ${URGENCY_LABELS[fields.urgency]}`);
  } else {
    lines.push(`❓ Timing: [standard / next day / same day?]`);
    missing.push('timing');
  }

  // "Complete" means we have the two fields that directly affect quoting accuracy.
  // Property + urgency have usable defaults so they don't block us.
  const isComplete = !missing.includes('job') && !missing.includes('name');

  const greeting = fields.customerName ? `Hi ${fields.customerName}! ` : 'Hi! ';

  let text = `${greeting}Here's what I've got so far:\n\n${lines.join('\n')}`;

  if (!isComplete) {
    text += '\n\nReply with the missing details and I\'ll get your quote ready straightaway.';
  }

  return { text, isComplete };
}

// ─── Quote generation + PDF + reply ──────────────────────────────────────────

async function generateAndReply(
  redis: RedisLike,
  db: Pool,
  whatsappNumber: string,
  fields: ExtractedFields,
  traderId: string,
  traderName: string,
): Promise<string> {
  const result = await saveConfirmedQuote(fields, traderId, db);

  if (result.status === 'manual_review') {
    await deleteSession(redis, whatsappNumber);
    return (
      `Thanks! I've noted the details but this job needs a manual check.\n\n` +
      `${traderName} will be in touch shortly with your quote.`
    );
  }

  if (result.status === 'needs_clarification') {
    // Shouldn't normally happen at this stage but handle gracefully
    await deleteSession(redis, whatsappNumber);
    return `${traderName} will be in touch with your quote shortly.`;
  }

  // Quote saved — generate PDF
  const { quoteId } = result;
  let pdfUrl: string | undefined;

  try {
    const [quoteRes, itemsRes, traderRes, rcRes] = await Promise.all([
      db.query('SELECT * FROM quotes WHERE id = $1', [quoteId]),
      db.query('SELECT * FROM quote_line_items WHERE quote_id = $1 ORDER BY sort_order', [quoteId]),
      db.query('SELECT name, business_name, location, whatsapp_number FROM traders WHERE id = $1', [traderId]),
      db.query('SELECT vat_registered, deposit_percent FROM rate_cards WHERE trader_id = $1', [traderId]),
    ]);

    const q  = quoteRes.rows[0];
    const tr = traderRes.rows[0];
    const rc = rcRes.rows[0];

    const pdfBuffer = await generateQuotePdf({
      id:            q.id,
      customerName:  q.customer_name,
      status:        q.status,
      subtotal:      Number(q.subtotal),
      vatAmount:     Number(q.vat_amount),
      total:         Number(q.total),
      depositAmount: Number(q.deposit_amount),
      notes:         q.notes ?? null,
      createdAt:     new Date(q.created_at),
      lineItems: itemsRes.rows.map((r) => ({
        description: r.description,
        qty:         Number(r.qty),
        unitPrice:   Number(r.unit_price),
        total:       Number(r.total),
        sortOrder:   r.sort_order,
      })),
      businessName:   tr.business_name,
      traderName:     tr.name,
      traderLocation: tr.location,
      whatsappNumber: tr.whatsapp_number ?? null,
      vatRegistered:  Boolean(rc?.vat_registered),
      depositPercent: Number(rc?.deposit_percent ?? 0),
    });

    pdfUrl = await uploadQuotePdf(pdfBuffer, traderId, quoteId);
    await db.query('UPDATE quotes SET pdf_url = $1, updated_at = NOW() WHERE id = $2', [pdfUrl, quoteId]);
  } catch {
    // PDF failure is non-fatal — customer still gets the totals message
  }

  await deleteSession(redis, whatsappNumber);

  const totals = await db.query('SELECT total, deposit_amount FROM quotes WHERE id = $1', [quoteId]);
  const tot    = totals.rows[0];
  const total  = tot ? `£${Number(tot.total).toFixed(2)}` : '';
  const dep    = tot ? `£${Number(tot.deposit_amount).toFixed(2)}` : '';

  return [
    `✅ Your quote from ${traderName} is ready!`,
    total  ? `💰 Total: ${total} (inc VAT)` : null,
    dep    ? `📋 Deposit to confirm: ${dep}` : null,
    pdfUrl ? `📄 View your quote: ${pdfUrl}` : null,
    'Quote valid for 30 days.',
  ].filter(Boolean).join('\n');
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Process one inbound customer WhatsApp message.
 *
 * Round 1 (no session): extract fields from first message, reply with a
 * structured ✅/❓ summary. Quote immediately if name + job were captured.
 *
 * Round 2+: re-extract using the full conversation as context, merge with
 * stored fields, and quote. Maximum 2 rounds to get a quote.
 */
export async function handleCustomerMessage(
  redis: RedisLike,
  db: Pool,
  whatsappNumber: string,
  inboundText: string,
  traderName: string,
  traderId: string,
): Promise<string> {
  // ── Restart command — wipe session and start fresh ─────────────────────────
  if (RESTART_KEYWORDS.has(inboundText.trim().toLowerCase())) {
    await deleteSession(redis, whatsappNumber);
    return `Hi! I'm the quoting assistant for ${traderName}. What job do you need a quote for?`;
  }

  const existingSession = await getSession(redis, whatsappNumber);

  // ── ROUND 1: first message ─────────────────────────────────────────────────
  if (!existingSession) {
    const extraction = await extractQuoteFields(inboundText, traderId, db);

    if (extraction.status === 'needs_clarification') {
      // AI couldn't parse the message at all — store session and ask
      const session: WhatsAppSession = {
        traderId,
        flow:           'customer',
        stage:          'awaiting_gaps',
        extracted:      {},
        messageHistory: [{ role: 'user', content: inboundText }],
        createdAt:      Date.now(),
        round:          1,
      };
      await setSession(redis, whatsappNumber, session);
      return extraction.question;
    }

    const { fields, availableJobs } = extraction;
    const { text, isComplete } = buildStructuredSummary(fields, availableJobs, traderName);

    if (isComplete) {
      // All key info captured — quote immediately, no back-and-forth needed
      return generateAndReply(redis, db, whatsappNumber, fields, traderId, traderName);
    }

    // Store session and send the structured summary
    const session: WhatsAppSession = {
      traderId,
      flow:           'customer',
      stage:          'awaiting_gaps',
      extracted:      fields,
      messageHistory: [
        { role: 'user',      content: inboundText },
        { role: 'assistant', content: text },
      ],
      createdAt: Date.now(),
      round:     1,
    };
    await setSession(redis, whatsappNumber, session);
    return text;
  }

  // ── ROUND 2+: fill in gaps ─────────────────────────────────────────────────
  const session = existingSession;
  session.messageHistory.push({ role: 'user', content: inboundText });
  session.round += 1;

  // Re-extract using the full conversation as a single transcript
  const combinedTranscript = session.messageHistory
    .map((m) => `${m.role === 'user' ? 'Customer' : 'Bot'}: ${m.content}`)
    .join('\n');

  const extraction = await extractQuoteFields(combinedTranscript, traderId, db);

  let mergedFields: ExtractedFields;

  if (extraction.status === 'extracted') {
    // Merge: prefer newly extracted non-empty values over previously stored ones
    const prev = session.extracted as Partial<ExtractedFields>;
    const next  = extraction.fields;
    mergedFields = {
      jobKey:              next.jobKey || prev.jobKey || '',
      propertyType:        (next.propertyType !== 'house' ? next.propertyType : (prev.propertyType ?? next.propertyType)),
      urgency:             (next.urgency !== 'standard'   ? next.urgency      : (prev.urgency      ?? next.urgency)),
      distanceMiles:       next.distanceMiles || prev.distanceMiles || 0,
      complexityFlags:     next.complexityFlags.length ? next.complexityFlags : (prev.complexityFlags ?? []),
      customerName:        next.customerName || prev.customerName || '',
      notes:               next.notes || prev.notes || '',
      includeCallOut:      next.includeCallOut ?? prev.includeCallOut ?? false,
      confidence:          next.confidence,
      clarificationNeeded: next.clarificationNeeded,
    };

    const { text, isComplete } = buildStructuredSummary(mergedFields, extraction.availableJobs, traderName);

    // After 2 rounds always proceed — avoid endless back-and-forth
    if (isComplete || session.round >= 2) {
      session.stage = 'generating';
      await setSession(redis, whatsappNumber, session);
      return generateAndReply(redis, db, whatsappNumber, mergedFields, traderId, traderName);
    }

    // Still missing critical fields after round 2 — one final prompt
    session.extracted = mergedFields;
    session.messageHistory.push({ role: 'assistant', content: text });
    await setSession(redis, whatsappNumber, session);
    return text;

  } else {
    // Extraction failed on follow-up — use whatever we stored and proceed
    mergedFields = {
      jobKey:              session.extracted.jobKey ?? '',
      propertyType:        session.extracted.propertyType ?? 'house',
      urgency:             session.extracted.urgency ?? 'standard',
      distanceMiles:       session.extracted.distanceMiles ?? 0,
      complexityFlags:     session.extracted.complexityFlags ?? [],
      customerName:        session.extracted.customerName ?? '',
      notes:               session.extracted.notes ?? '',
      includeCallOut:      session.extracted.includeCallOut ?? false,
      confidence:          'low',
      clarificationNeeded: null,
    };
    session.stage = 'generating';
    await setSession(redis, whatsappNumber, session);
    return generateAndReply(redis, db, whatsappNumber, mergedFields, traderId, traderName);
  }
}

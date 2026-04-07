import Anthropic from '@anthropic-ai/sdk';
import type { Pool } from 'pg';
import { WHATSAPP_SESSION_TTL_SECONDS } from '@quotebot/shared';
import type { PricingInput } from '@quotebot/shared';
import { generateQuote } from './quoteAI.js';
import { generateQuotePdf } from './pdfGenerator.js';
import { uploadQuotePdf } from './blobStorage.js';

// ─── Types ────────────────────────────────────────────────────────────────────

// Duck-typed subset of the redis v4 client — avoids tight coupling to the type
interface RedisLike {
  get(key: string): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface WhatsAppSession {
  traderId:       string;
  flow:           'customer' | 'trader';
  stage:          string;
  collected:      Partial<PricingInput>;
  messageHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  createdAt:      number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL          = 'claude-opus-4-6';
const SESSION_PREFIX = 'session:';
const TTL            = WHATSAPP_SESSION_TTL_SECONDS; // 86400s = 24h

// Stage order — used to advance the system-prompt context
const STAGES = ['greeting', 'job_type', 'property_type', 'urgency', 'customer_name', 'generating'] as const;

// ─── Singleton client ─────────────────────────────────────────────────────────

const anthropic = new Anthropic();

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

// ─── Customer flow ────────────────────────────────────────────────────────────

/**
 * Process one inbound customer message.
 * Drives a Claude conversation through the quoting stages.
 * When Claude emits READY_TO_QUOTE, runs the full pipeline and returns a quote summary.
 *
 * @returns The text to send back to the customer via TwiML.
 */
export async function handleCustomerMessage(
  redis: RedisLike,
  db: Pool,
  whatsappNumber: string,
  inboundText: string,
  traderName: string,
  traderId: string,
): Promise<string> {
  // Load or initialise session
  let session = await getSession(redis, whatsappNumber);
  if (!session) {
    session = {
      traderId,
      flow:           'customer',
      stage:          'greeting',
      collected:      {},
      messageHistory: [],
      createdAt:      Date.now(),
    };
  }

  // Append customer turn
  session.messageHistory.push({ role: 'user', content: inboundText });

  // Build system prompt (matches spec exactly)
  const collectedStr =
    Object.entries(session.collected).length > 0
      ? Object.entries(session.collected)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join(', ')
      : 'nothing yet';

  const system =
    `You are a friendly quoting assistant for ${traderName}. ` +
    `Ask ONE question at a time to collect: job type, property type, urgency, customer name. ` +
    `Current stage: ${session.stage}. ` +
    `Collected so far: ${collectedStr}. ` +
    `When you have enough to quote (job type + property type + name minimum), ` +
    `respond with exactly: READY_TO_QUOTE`;

  // Call Claude with the full conversation history
  const messages: Anthropic.MessageParam[] = session.messageHistory.map((m) => ({
    role:    m.role,
    content: m.content,
  }));

  const response = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 256,
    system,
    messages,
  });

  const assistantText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  // ── READY_TO_QUOTE ─────────────────────────────────────────────────────────
  if (assistantText.includes('READY_TO_QUOTE')) {
    session.stage = 'generating';
    await setSession(redis, whatsappNumber, session);

    // Build a plain-text transcript from the conversation history
    // generateQuote's Claude Call 1 will extract structured fields from this.
    const transcript = session.messageHistory
      .map((m) => `${m.role === 'user' ? 'Customer' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const result = await generateQuote(transcript, traderId, db);

    // Claude needs clarification before it can quote
    if (result.status === 'needs_clarification') {
      session.messageHistory.push({ role: 'assistant', content: result.question });
      session.stage = 'customer_name'; // stay in conversation
      await setSession(redis, whatsappNumber, session);
      return result.question;
    }

    // Job not recognised — hand off to trader for manual review
    if (result.status === 'manual_review') {
      await deleteSession(redis, whatsappNumber);
      return (
        `Thanks! I've noted the details but this job needs a manual review.\n\n` +
        `${traderName} will be in touch shortly with your quote.`
      );
    }

    // ── Quote generated — produce PDF and reply ──────────────────────────────
    const { quoteId } = result;
    let pdfUrl: string | undefined;

    try {
      const [quoteRes, itemsRes, traderRes, rcRes] = await Promise.all([
        db.query('SELECT * FROM quotes WHERE id = $1', [quoteId]),
        db.query(
          'SELECT * FROM quote_line_items WHERE quote_id = $1 ORDER BY sort_order',
          [quoteId],
        ),
        db.query(
          'SELECT name, business_name, location, whatsapp_number FROM traders WHERE id = $1',
          [traderId],
        ),
        db.query(
          'SELECT vat_registered, deposit_percent FROM rate_cards WHERE trader_id = $1',
          [traderId],
        ),
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
        lineItems:     itemsRes.rows.map((r) => ({
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

      await db.query(
        'UPDATE quotes SET pdf_url = $1, updated_at = NOW() WHERE id = $2',
        [pdfUrl, quoteId],
      );
    } catch {
      // PDF generation failure is non-fatal — customer still gets the quote summary
    }

    await deleteSession(redis, whatsappNumber);

    // Load totals for the reply message
    const totalsRes = await db.query(
      'SELECT total, deposit_amount FROM quotes WHERE id = $1',
      [quoteId],
    );
    const tot     = totalsRes.rows[0];
    const total   = tot ? `£${Number(tot.total).toFixed(2)}` : '';
    const deposit = tot ? `£${Number(tot.deposit_amount).toFixed(2)}` : '';

    return [
      `✅ Your quote from ${traderName} is ready!`,
      total   ? `💰 Total: ${total} (inc VAT)` : null,
      deposit ? `📋 Deposit to confirm booking: ${deposit}` : null,
      pdfUrl  ? `📄 View your quote: ${pdfUrl}` : null,
      'Quote valid for 30 days.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // ── Normal conversation turn ───────────────────────────────────────────────
  session.messageHistory.push({ role: 'assistant', content: assistantText });

  // Advance stage for the next system-prompt's context
  const currentIdx = STAGES.indexOf(session.stage as (typeof STAGES)[number]);
  if (currentIdx >= 0 && currentIdx < STAGES.length - 2) {
    session.stage = STAGES[currentIdx + 1];
  }

  await setSession(redis, whatsappNumber, session);
  return assistantText;
}

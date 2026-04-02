import type { FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { WHATSAPP_SESSION_TTL_SECONDS } from '@quotebot/shared';
import { transcribeBuffer } from '../../services/transcription.js';
import { extractJobFromTranscript } from '../../services/ai-extract.js';
import { computeQuoteTotals, computeLineItemNet } from '../../services/pricing.js';
import { generateQuoteNumber, QUOTE_NUMBER_PREFIX, addDays } from '@quotebot/shared';
import type { WhatsAppSession } from '@quotebot/shared';

const SESSION_PREFIX = 'wa:session:';

export async function twilioWebhookRoutes(fastify: FastifyInstance) {
  // POST /webhooks/twilio/message
  fastify.post('/message', {
    config: { rawBody: true },
  }, async (req, reply) => {
    // Validate Twilio signature
    const signature = req.headers['x-twilio-signature'] as string;
    const url = `${process.env.API_URL}/webhooks/twilio/message`;

    if (process.env.NODE_ENV === 'production') {
      const valid = twilio.validateRequest(
        process.env.TWILIO_AUTH_TOKEN!,
        signature,
        url,
        req.body as Record<string, string>
      );
      if (!valid) {
        return reply.code(403).send('Forbidden');
      }
    }

    const body = req.body as Record<string, string>;
    const from = body.From; // e.g. whatsapp:+447700900000
    const messageBody = body.Body?.trim() ?? '';
    const numMedia = Number(body.NumMedia ?? 0);
    const mediaUrl0 = body.MediaUrl0;
    const mediaContentType0 = body.MediaContentType0;

    const { sql, redis } = fastify;

    // Find trader by WhatsApp number
    const phoneNumber = from.replace('whatsapp:', '');
    const [trader] = await sql`
      SELECT id, subscription_tier, default_vat_rate, default_markup, default_labour_rate, quote_validity_days
      FROM traders WHERE whatsapp_number = ${phoneNumber}
    `;

    if (!trader) {
      return replyTwiML(reply, "Hi! I don't recognise this number. Please set up your QuoteBot account first at quotebot.app");
    }

    // Load or create session
    const sessionKey = `${SESSION_PREFIX}${trader.id}`;
    const rawSession = await redis.get(sessionKey);
    let session: WhatsAppSession = rawSession
      ? JSON.parse(rawSession)
      : {
          traderId: trader.id,
          state: 'idle',
          lastMessageAt: Date.now(),
          messageHistory: [],
        };

    session.lastMessageAt = Date.now();

    // Handle voice note
    if (numMedia > 0 && mediaUrl0 && mediaContentType0?.startsWith('audio/')) {
      await redis.setex(sessionKey, WHATSAPP_SESSION_TTL_SECONDS, JSON.stringify({
        ...session, state: 'processing',
      }));

      try {
        // Download audio from Twilio
        const audioBuffer = await downloadTwilioMedia(mediaUrl0);

        // Transcribe
        const transcript = await transcribeBuffer(audioBuffer, 'voice.ogg', 'audio/ogg');

        // Extract job
        const extracted = await extractJobFromTranscript(transcript);

        // Create draft quote
        const lineItems = extracted.lineItems.map((li) => ({
          quantity: li.quantity ?? 1,
          unit: li.unit ?? 'each',
          unitCostPence: li.estimatedMaterialCostPence ?? 0,
          markupPct: trader.default_markup,
          labourMinutes: li.labourMinutes ?? 0,
          labourRatePence: trader.default_labour_rate,
        }));

        const vatPct = trader.default_vat_rate;
        const totals = computeQuoteTotals(lineItems, vatPct);

        const [seqRow] = await sql`
          UPDATE traders SET quote_sequence = quote_sequence + 1, quotes_used_this_month = quotes_used_this_month + 1
          WHERE id = ${trader.id} RETURNING quote_sequence
        `;
        const quoteNumber = generateQuoteNumber(QUOTE_NUMBER_PREFIX, seqRow.quote_sequence);
        const validUntil = addDays(new Date(), trader.quote_validity_days);

        const [quote] = await sql`
          INSERT INTO quotes (
            trader_id, status, job_type, job_description, job_address,
            ai_raw_transcript, ai_extracted_data,
            subtotal_net_pence, vat_pct, vat_amount_pence, total_gross_pence,
            quote_number, valid_until
          ) VALUES (
            ${trader.id}, 'pending_review', ${extracted.jobType}, ${extracted.summary},
            ${extracted.jobAddress ?? null}, ${transcript}, ${JSON.stringify(extracted)},
            ${totals.subtotalNetPence}, ${vatPct}, ${totals.vatAmountPence}, ${totals.totalGrossPence},
            ${quoteNumber}, ${validUntil}
          ) RETURNING id
        `;

        if (lineItems.length > 0) {
          await sql`
            INSERT INTO quote_line_items ${sql(
              extracted.lineItems.map((li, i) => ({
                quote_id: quote.id,
                sort_order: i,
                description: li.description,
                quantity: li.quantity ?? 1,
                unit: li.unit ?? 'each',
                unit_cost_pence: li.estimatedMaterialCostPence ?? 0,
                markup_pct: trader.default_markup,
                labour_minutes: li.labourMinutes ?? 0,
                labour_rate_pence: trader.default_labour_rate,
                line_net_pence: computeLineItemNet({
                  quantity: li.quantity ?? 1,
                  unitCostPence: li.estimatedMaterialCostPence ?? 0,
                  markupPct: trader.default_markup,
                  labourMinutes: li.labourMinutes ?? 0,
                  labourRatePence: trader.default_labour_rate,
                }),
              }))
            )}
          `;
        }

        const { formatGBP } = await import('@quotebot/shared');
        const clarifications = extracted.clarificationNeeded?.length
          ? `\n\n❓ Questions: ${extracted.clarificationNeeded.join(', ')}`
          : '';

        const responseMsg = [
          `✅ *${quoteNumber}* created!`,
          `📋 ${extracted.summary}`,
          `💰 Total: *${formatGBP(totals.totalGrossPence)}* (inc. ${vatPct}% VAT)`,
          `\nReview & send it in your app: quotebot.app/quotes/${quote.id}`,
          clarifications,
        ].filter(Boolean).join('\n');

        session = { ...session, state: 'done', quoteId: quote.id };
        await redis.setex(sessionKey, WHATSAPP_SESSION_TTL_SECONDS, JSON.stringify(session));

        return replyTwiML(reply, responseMsg);
      } catch (err) {
        fastify.log.error(err);
        session = { ...session, state: 'idle' };
        await redis.setex(sessionKey, WHATSAPP_SESSION_TTL_SECONDS, JSON.stringify(session));
        return replyTwiML(reply, "Sorry, I couldn't process that voice note. Please try again.");
      }
    }

    // Text commands
    const lower = messageBody.toLowerCase();
    if (lower === 'help' || lower === 'hi' || lower === 'hello') {
      return replyTwiML(reply, [
        '👋 Hi! I\'m your QuoteBot assistant.',
        '',
        'Send me a *voice note* describing the job and I\'ll create a quote draft for you.',
        '',
        'Commands:',
        '• *status* — see your recent quotes',
        '• *help* — show this message',
      ].join('\n'));
    }

    if (lower === 'status') {
      const recentQuotes = await sql`
        SELECT quote_number, status, total_gross_pence, created_at
        FROM quotes WHERE trader_id = ${trader.id}
        ORDER BY created_at DESC LIMIT 5
      `;
      const { formatGBP } = await import('@quotebot/shared');
      const list = recentQuotes
        .map((q: { quote_number: string; status: string; total_gross_pence: number }) =>
          `• ${q.quote_number} — ${q.status} — ${formatGBP(q.total_gross_pence)}`)
        .join('\n');
      return replyTwiML(reply, list || 'No quotes yet. Send a voice note to create one!');
    }

    // Default
    return replyTwiML(reply, "Send me a voice note describing the job and I'll create a quote. Type *help* for more options.");
  });
}

function replyTwiML(reply: Parameters<typeof reply.send>[0] extends string ? never : typeof import('fastify').FastifyReply.prototype, message: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = reply as any;
  r.type('text/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`
  );
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function downloadTwilioMedia(url: string): Promise<Buffer> {
  const authHeader = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
  ).toString('base64');

  const res = await fetch(url, { headers: { Authorization: `Basic ${authHeader}` } });
  if (!res.ok) throw new Error(`Failed to download Twilio media: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

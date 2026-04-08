import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { createClient } from 'redis';
import twilio from 'twilio';
import { generateQuote } from '../../services/quoteAI.js';
import { handleCustomerMessage } from '../../services/whatsappSession.js';
import '../../plugins/db.js';
import '../../plugins/redis.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function twiml(reply: FastifyReply, message: string): void {
  reply.type('text/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Response><Message>${escXml(message)}</Message></Response>`,
  );
}

/** Strip the "whatsapp:" prefix Twilio adds to every number. */
function stripPrefix(number: string): string {
  return number.replace(/^whatsapp:/i, '');
}

/** Download a Twilio-hosted media file using Basic auth. */
async function downloadTwilioMedia(
  url: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const auth = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`,
  ).toString('base64');

  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`Twilio media download failed: ${res.status}`);

  const contentType = res.headers.get('content-type') ?? 'audio/ogg';
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType };
}

// ─── Trader row type ──────────────────────────────────────────────────────────

interface TraderRow {
  id:              string;
  name:            string;
  business_name:   string;
  whatsapp_number: string | null;
  isTrader:        boolean;
}

/** Look up the trader and determine whether the sender is the trader themselves.
 *
 *  Production: each trader has their own provisioned Twilio number (stored in
 *              traders.whatsapp_number). We match on the To (recipient) field.
 *  Sandbox MVP: all traders share TWILIO_WHATSAPP_NUMBER. We fall back to
 *               matching the From (sender) field — if it's a registered trader
 *               number, the flow is always "trader".
 */
async function findTrader(
  db: Pool,
  fromNumber: string,
  toNumber: string,
): Promise<TraderRow | null> {
  const byTo = await db.query<Omit<TraderRow, 'isTrader'>>(
    'SELECT id, name, business_name, whatsapp_number FROM traders WHERE whatsapp_number = $1',
    [toNumber],
  );
  if (byTo.rows[0]) {
    const row = byTo.rows[0];
    return { ...row, isTrader: fromNumber === (row.whatsapp_number ?? '') };
  }

  // Sandbox fallback: sender IS a registered trader
  const byFrom = await db.query<Omit<TraderRow, 'isTrader'>>(
    'SELECT id, name, business_name, whatsapp_number FROM traders WHERE whatsapp_number = $1',
    [fromNumber],
  );
  if (byFrom.rows[0]) {
    return { ...byFrom.rows[0], isTrader: true };
  }

  return null;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function whatsappWebhookRoutes(fastify: FastifyInstance) {
  const db:    Pool                          = fastify.db;
  const redis: ReturnType<typeof createClient> = fastify.redis;

  // POST / — no JWT auth; validated by Twilio signature
  fastify.post('/', async (req, reply) => {
    const params    = req.body as Record<string, string>;
    const signature = (req.headers['x-twilio-signature'] as string) ?? '';
    const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';

    // ── Signature verification ─────────────────────────────────────────────
    if (authToken) {
      // Build the URL from the incoming request — works without API_URL env var
      // and survives Azure's reverse proxy (HTTPS is always terminated at the edge)
      const webhookUrl = `https://${req.headers.host}${req.url}`;
      const valid = twilio.validateRequest(authToken, signature, webhookUrl, params);
      if (!valid) {
        fastify.log.warn({ signature }, 'Invalid Twilio signature — request rejected');
        return reply.code(403).send('Forbidden');
      }
    } else {
      fastify.log.warn('TWILIO_AUTH_TOKEN not set — skipping signature check');
    }

    // ── Extract fields ─────────────────────────────────────────────────────
    const from     = params.From ?? '';   // whatsapp:+447700900000
    const to       = params.To   ?? '';   // whatsapp:+14155238886
    const body     = (params.Body ?? '').trim();
    const mediaUrl = params.MediaUrl0;

    const fromNumber = stripPrefix(from);
    const toNumber   = stripPrefix(to);

    // ── Trader lookup ──────────────────────────────────────────────────────
    const trader = await findTrader(db, fromNumber, toNumber);

    if (!trader) {
      twiml(reply, "Hi! I don't recognise this number. Please contact QuoteBot support.");
      return;
    }

    const appUrl = process.env.APP_URL ?? 'https://app.quotebot.io';

    // ── TRADER FLOW ────────────────────────────────────────────────────────
    if (trader.isTrader) {
      const dispatchTraderResult = async (transcript: string): Promise<void> => {
        const result = await generateQuote(transcript, trader.id, db);

        if (result.status === 'ready') {
          const quoteRes = await db.query(
            'SELECT customer_name, total FROM quotes WHERE id = $1',
            [result.quoteId],
          );
          const q = quoteRes.rows[0];
          twiml(
            reply,
            `✅ Quote generated for ${q?.customer_name || 'customer'}: ` +
            `£${Number(q?.total ?? 0).toFixed(2)}\n` +
            `Review and send: ${appUrl}/quotes/${result.quoteId}`,
          );
          return;
        }

        if (result.status === 'needs_clarification') {
          twiml(reply, `❓ ${result.question}`);
          return;
        }

        twiml(reply, `⚠️ Manual review needed: ${result.warning}`);
      };

      // Voice note — text transcription not available via WhatsApp; ask trader to type
      if (mediaUrl) {
        twiml(reply, "Voice notes aren't supported here. Please type the job description as a text message.");
        return;
      }

      // Text description
      if (body) {
        try {
          await dispatchTraderResult(body);
        } catch (err) {
          fastify.log.error({ err }, 'Trader text processing failed');
          twiml(reply, "Sorry, I couldn't process that. Please try again.");
        }
        return;
      }

      twiml(reply, '👋 Send a voice note or text description to generate a quote.');
      return;
    }

    // ── CUSTOMER FLOW ──────────────────────────────────────────────────────
    let customerMessage = body;

    if (mediaUrl && !body) {
      twiml(reply, "Sorry, I can't process voice messages. Please type your request instead.");
      return;
    }

    if (!customerMessage) {
      twiml(
        reply,
        `Hi! I'm the quoting assistant for ${trader.name}. What job do you need a quote for?`,
      );
      return;
    }

    try {
      const replyText = await handleCustomerMessage(
        redis,
        db,
        fromNumber,
        customerMessage,
        trader.name,
        trader.id,
      );
      twiml(reply, replyText);
    } catch (err) {
      fastify.log.error({ err }, 'Customer message handling failed');
      twiml(reply, "Sorry, something went wrong. Please try again in a moment.");
    }
  });
}

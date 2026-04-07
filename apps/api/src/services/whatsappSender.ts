import twilio from 'twilio';

// ─── Singleton Twilio client ──────────────────────────────────────────────────

let _client: ReturnType<typeof twilio> | null = null;

function getClient(): ReturnType<typeof twilio> {
  if (!_client) {
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set');
    _client = twilio(sid, token);
  }
  return _client;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a WhatsApp message via Twilio.
 *
 * @param to   Recipient number — accepts E.164 (+447700900000) or prefixed (whatsapp:+44...).
 * @param body Message text.
 */
export async function sendMessage(to: string, body: string): Promise<void> {
  const from = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!from) throw new Error('TWILIO_WHATSAPP_NUMBER is not set');

  // Normalise — Twilio requires the whatsapp: prefix on both sides
  const normTo   = to.startsWith('whatsapp:')   ? to   : `whatsapp:${to}`;
  const normFrom = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;

  await getClient().messages.create({ from: normFrom, to: normTo, body });
}

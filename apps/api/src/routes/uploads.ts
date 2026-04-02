import type { FastifyInstance } from 'fastify';
import { ALLOWED_AUDIO_MIME_TYPES, MAX_VOICE_FILE_SIZE_BYTES } from '@quotebot/shared';
import { transcribeBuffer } from '../services/transcription.js';
import { extractJobFromTranscript } from '../services/ai-extract.js';
import { uploadVoiceNote } from '../services/blob-storage.js';
import { computeLineItemNet, computeQuoteTotals } from '../services/pricing.js';
import { generateQuoteNumber, QUOTE_NUMBER_PREFIX, addDays } from '@quotebot/shared';

export async function uploadRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  /**
   * POST /uploads/voice
   * Accepts multipart audio file, transcribes with Whisper, extracts job with Claude,
   * creates a draft quote, returns the quote + extracted data for trader review.
   */
  fastify.post('/voice', auth, async (req, reply) => {
    const { traderId } = req.user;
    const { sql } = fastify;

    const data = await req.file();
    if (!data) return reply.code(400).send({ message: 'No file uploaded' });

    if (!ALLOWED_AUDIO_MIME_TYPES.includes(data.mimetype)) {
      return reply.code(400).send({ message: `Unsupported audio format: ${data.mimetype}` });
    }

    // Read file into buffer (respect size limit)
    const chunks: Buffer[] = [];
    let totalSize = 0;
    for await (const chunk of data.file) {
      totalSize += chunk.length;
      if (totalSize > MAX_VOICE_FILE_SIZE_BYTES) {
        return reply.code(413).send({ message: 'Audio file too large (max 25MB)' });
      }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Upload to blob storage
    const blobKey = await uploadVoiceNote(buffer, data.mimetype, traderId);

    // Transcribe
    const transcript = await transcribeBuffer(buffer, data.filename ?? 'audio', data.mimetype);

    // Extract job details with AI
    const extracted = await extractJobFromTranscript(transcript);

    // Fetch trader defaults
    const [trader] = await sql`
      SELECT default_vat_rate, default_markup, default_labour_rate, quote_validity_days
      FROM traders WHERE id = ${traderId}
    `;

    // Build line items from AI extraction
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

    // Increment sequence & create quote
    const [seqRow] = await sql`
      UPDATE traders SET quote_sequence = quote_sequence + 1, quotes_used_this_month = quotes_used_this_month + 1
      WHERE id = ${traderId} RETURNING quote_sequence
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
        ${traderId}, 'pending_review',
        ${extracted.jobType},
        ${extracted.summary},
        ${extracted.jobAddress ?? null},
        ${transcript},
        ${JSON.stringify(extracted)},
        ${totals.subtotalNetPence}, ${vatPct}, ${totals.vatAmountPence}, ${totals.totalGrossPence},
        ${quoteNumber}, ${validUntil}
      )
      RETURNING id
    `;

    // Insert line items
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

    reply.code(201).send({
      quoteId: quote.id,
      quoteNumber,
      transcript,
      extracted,
      blobKey,
      totals,
    });
  });
}

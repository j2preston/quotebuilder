import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { addDays, generateQuoteNumber, QUOTE_NUMBER_PREFIX, SUBSCRIPTION_LIMITS } from '@quotebot/shared';
import { computeLineItemNet, computeQuoteTotals } from '../services/pricing.js';
import { generateQuotePdf } from '../services/pdf.js';
import { uploadPdf } from '../services/blob-storage.js';
import type { UpdateQuoteRequest } from '@quotebot/shared';

const lineItemSchema = z.object({
  id: z.string().uuid().optional(),
  sortOrder: z.number().int().min(0),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string(),
  unitCostPence: z.number().int().min(0),
  markupPct: z.number().min(0).max(500),
  labourMinutes: z.number().int().min(0),
  labourRatePence: z.number().int().min(0),
});

const updateQuoteSchema = z.object({
  status: z.enum(['draft', 'pending_review', 'ready', 'sent', 'viewed', 'accepted', 'declined', 'expired']).optional(),
  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().optional(),
  jobType: z.string().optional(),
  jobDescription: z.string().optional(),
  jobAddress: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  lineItems: z.array(lineItemSchema).optional(),
  vatPct: z.number().int().min(0).max(100).optional(),
});

export async function quoteRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  // GET /quotes — list quotes for trader
  fastify.get('/', auth, async (req, reply) => {
    const { traderId } = req.user;
    const query = req.query as { status?: string; page?: string; pageSize?: string };
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize ?? 20)));
    const offset = (page - 1) * pageSize;

    const { sql } = fastify;

    let rows;
    let countRow;

    if (query.status) {
      rows = await sql`
        SELECT q.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
        FROM quotes q
        LEFT JOIN customers c ON c.id = q.customer_id
        WHERE q.trader_id = ${traderId} AND q.status = ${query.status}
        ORDER BY q.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `;
      [countRow] = await sql`SELECT COUNT(*)::int AS total FROM quotes WHERE trader_id = ${traderId} AND status = ${query.status}`;
    } else {
      rows = await sql`
        SELECT q.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
        FROM quotes q
        LEFT JOIN customers c ON c.id = q.customer_id
        WHERE q.trader_id = ${traderId}
        ORDER BY q.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `;
      [countRow] = await sql`SELECT COUNT(*)::int AS total FROM quotes WHERE trader_id = ${traderId}`;
    }

    const quotes = await Promise.all(rows.map((r) => rowToQuote(r, sql)));

    reply.send({
      data: quotes,
      total: countRow.total,
      page,
      pageSize,
    });
  });

  // GET /quotes/:id
  fastify.get<{ Params: { id: string } }>('/:id', auth, async (req, reply) => {
    const { traderId } = req.user;
    const quote = await fetchQuoteForTrader(fastify.sql, req.params.id, traderId);
    if (!quote) return reply.code(404).send({ message: 'Quote not found' });
    reply.send(quote);
  });

  // POST /quotes — create a manual quote
  fastify.post('/', auth, async (req, reply) => {
    const { traderId } = req.user;
    const { sql } = fastify;

    // Check quota
    const [trader] = await sql`
      SELECT subscription_tier, quotes_used_this_month, quota_reset_at,
             default_vat_rate, default_labour_rate, quote_validity_days
      FROM traders WHERE id = ${traderId}
    `;
    const limit = SUBSCRIPTION_LIMITS[trader.subscription_tier as 'free' | 'starter' | 'pro'].quotesPerMonth;
    if (trader.quotes_used_this_month >= limit) {
      return reply.code(402).send({ message: `Quote limit reached for ${trader.subscription_tier} plan` });
    }

    const body = req.body as Partial<UpdateQuoteRequest>;
    const vatPct = body.vatPct ?? trader.default_vat_rate;
    const lineItems = (body.lineItems ?? []).map((li) => ({
      ...li,
      labourRatePence: li.labourRatePence || trader.default_labour_rate,
    }));

    const totals = computeQuoteTotals(lineItems, vatPct);

    // Increment sequence
    const [seqRow] = await sql`
      UPDATE traders SET quote_sequence = quote_sequence + 1 WHERE id = ${traderId}
      RETURNING quote_sequence
    `;
    const quoteNumber = generateQuoteNumber(QUOTE_NUMBER_PREFIX, seqRow.quote_sequence);
    const validUntil = addDays(new Date(), trader.quote_validity_days);

    const [quote] = await sql`
      INSERT INTO quotes (
        trader_id, customer_id, status, job_type, job_description, job_address,
        internal_notes, subtotal_net_pence, vat_pct, vat_amount_pence, total_gross_pence,
        quote_number, valid_until
      ) VALUES (
        ${traderId},
        ${body.customerId ?? null},
        'draft',
        ${body.jobType ?? 'other'},
        ${body.jobDescription ?? ''},
        ${body.jobAddress ?? null},
        ${body.internalNotes ?? null},
        ${totals.subtotalNetPence},
        ${vatPct},
        ${totals.vatAmountPence},
        ${totals.totalGrossPence},
        ${quoteNumber},
        ${validUntil}
      )
      RETURNING id
    `;

    // Insert line items
    if (lineItems.length > 0) {
      await sql`
        INSERT INTO quote_line_items ${sql(
          lineItems.map((li, i) => ({
            quote_id: quote.id,
            sort_order: li.sortOrder ?? i,
            description: li.description,
            quantity: li.quantity,
            unit: li.unit,
            unit_cost_pence: li.unitCostPence,
            markup_pct: li.markupPct,
            labour_minutes: li.labourMinutes,
            labour_rate_pence: li.labourRatePence,
            line_net_pence: computeLineItemNet(li),
          }))
        )}
      `;
    }

    // Increment usage
    await sql`UPDATE traders SET quotes_used_this_month = quotes_used_this_month + 1 WHERE id = ${traderId}`;

    const fullQuote = await fetchQuoteForTrader(sql, quote.id, traderId);
    reply.code(201).send(fullQuote);
  });

  // PATCH /quotes/:id
  fastify.patch<{ Params: { id: string }; Body: UpdateQuoteRequest }>('/:id', auth, async (req, reply) => {
    const { traderId } = req.user;
    const { sql } = fastify;
    const body = updateQuoteSchema.parse(req.body);

    const existing = await fetchQuoteForTrader(sql, req.params.id, traderId);
    if (!existing) return reply.code(404).send({ message: 'Quote not found' });

    const updates: Record<string, unknown> = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.jobType !== undefined) updates.job_type = body.jobType;
    if (body.jobDescription !== undefined) updates.job_description = body.jobDescription;
    if ('jobAddress' in body) updates.job_address = body.jobAddress ?? null;
    if ('internalNotes' in body) updates.internal_notes = body.internalNotes ?? null;
    if ('customerId' in body) updates.customer_id = body.customerId ?? null;

    let lineItems = existing.lineItems;

    if (body.lineItems !== undefined) {
      const vatPct = body.vatPct ?? existing.vatPct;
      const [traderRow] = await sql`SELECT default_labour_rate FROM traders WHERE id = ${traderId}`;

      const items = body.lineItems.map((li) => ({
        ...li,
        labourRatePence: li.labourRatePence || traderRow.default_labour_rate,
      }));

      const totals = computeQuoteTotals(items, vatPct);
      updates.subtotal_net_pence = totals.subtotalNetPence;
      updates.vat_pct = vatPct;
      updates.vat_amount_pence = totals.vatAmountPence;
      updates.total_gross_pence = totals.totalGrossPence;

      // Replace all line items
      await sql`DELETE FROM quote_line_items WHERE quote_id = ${req.params.id}`;
      if (items.length > 0) {
        await sql`
          INSERT INTO quote_line_items ${sql(
            items.map((li, i) => ({
              quote_id: req.params.id,
              sort_order: li.sortOrder ?? i,
              description: li.description,
              quantity: li.quantity,
              unit: li.unit,
              unit_cost_pence: li.unitCostPence,
              markup_pct: li.markupPct,
              labour_minutes: li.labourMinutes,
              labour_rate_pence: li.labourRatePence,
              line_net_pence: computeLineItemNet(li),
            }))
          )}
        `;
      }
    }

    if (Object.keys(updates).length > 0) {
      await sql`UPDATE quotes SET ${sql(updates)}, updated_at = NOW() WHERE id = ${req.params.id} AND trader_id = ${traderId}`;
    }

    const updated = await fetchQuoteForTrader(sql, req.params.id, traderId);
    reply.send(updated);
  });

  // POST /quotes/:id/pdf — generate/regenerate PDF
  fastify.post<{ Params: { id: string } }>('/:id/pdf', auth, async (req, reply) => {
    const { traderId } = req.user;
    const { sql } = fastify;

    const quote = await fetchQuoteForTrader(sql, req.params.id, traderId);
    if (!quote) return reply.code(404).send({ message: 'Quote not found' });

    const [traderRow] = await sql`
      SELECT business_name, full_name, email, phone, address_line1, city, postcode,
             vat_number, logo_url, quote_footer_text
      FROM traders WHERE id = ${traderId}
    `;

    const pdfBuffer = await generateQuotePdf(quote, {
      businessName: traderRow.business_name,
      fullName: traderRow.full_name,
      email: traderRow.email,
      phone: traderRow.phone,
      addressLine1: traderRow.address_line1,
      city: traderRow.city,
      postcode: traderRow.postcode,
      vatNumber: traderRow.vat_number,
      logoUrl: traderRow.logo_url,
      quoteFooterText: traderRow.quote_footer_text,
    });

    const pdfUrl = await uploadPdf(pdfBuffer, traderId, req.params.id);
    await sql`UPDATE quotes SET pdf_url = ${pdfUrl}, updated_at = NOW() WHERE id = ${req.params.id}`;

    reply.send({ pdfUrl });
  });

  // DELETE /quotes/:id
  fastify.delete<{ Params: { id: string } }>('/:id', auth, async (req, reply) => {
    const { traderId } = req.user;
    const result = await fastify.sql`
      DELETE FROM quotes WHERE id = ${req.params.id} AND trader_id = ${traderId}
      RETURNING id
    `;
    if (result.length === 0) return reply.code(404).send({ message: 'Quote not found' });
    reply.code(204).send();
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchQuoteForTrader(sql: any, quoteId: string, traderId: string) {
  const [row] = await sql`
    SELECT q.*, c.name AS customer_name, c.email AS customer_email,
           c.phone AS customer_phone, c.address_line1 AS customer_address
    FROM quotes q
    LEFT JOIN customers c ON c.id = q.customer_id
    WHERE q.id = ${quoteId} AND q.trader_id = ${traderId}
  `;
  if (!row) return null;
  return rowToQuote(row, sql);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rowToQuote(row: any, sql: any) {
  const lineItemRows = await sql`
    SELECT * FROM quote_line_items WHERE quote_id = ${row.id} ORDER BY sort_order
  `;

  return {
    id: row.id,
    traderId: row.trader_id,
    customerId: row.customer_id,
    customer: row.customer_name
      ? {
          id: row.customer_id,
          name: row.customer_name,
          email: row.customer_email,
          phone: row.customer_phone,
        }
      : undefined,
    lineItems: lineItemRows.map((li: any) => ({
      id: li.id,
      quoteId: li.quote_id,
      sortOrder: li.sort_order,
      description: li.description,
      quantity: Number(li.quantity),
      unit: li.unit,
      unitCostPence: li.unit_cost_pence,
      markupPct: li.markup_pct,
      labourMinutes: li.labour_minutes,
      labourRatePence: li.labour_rate_pence,
      lineNetPence: li.line_net_pence,
      createdAt: li.created_at,
    })),
    status: row.status,
    jobType: row.job_type,
    jobDescription: row.job_description,
    jobAddress: row.job_address,
    internalNotes: row.internal_notes,
    aiRawTranscript: row.ai_raw_transcript,
    aiExtractedData: row.ai_extracted_data,
    subtotalNetPence: row.subtotal_net_pence,
    vatPct: row.vat_pct,
    vatAmountPence: row.vat_amount_pence,
    totalGrossPence: row.total_gross_pence,
    quoteNumber: row.quote_number,
    validUntil: row.valid_until,
    sentAt: row.sent_at,
    viewedAt: row.viewed_at,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
    stripePaymentLinkUrl: row.stripe_payment_link_url,
    pdfUrl: row.pdf_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

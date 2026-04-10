import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';
import { authenticate } from '../middleware/auth.js';
import { generateQuote, extractQuoteFields, saveConfirmedQuote } from '../services/quoteAI.js';
import type { ExtractedFields } from '../services/quoteAI.js';
import { generateQuotePdf } from '../services/pdfGenerator.js';
import { uploadQuotePdf } from '../services/blobStorage.js';
import { calcQuoteTotals, roundMoney } from '@quotebot/shared';

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const generateSchema = z.object({
  transcript: z.string().min(1, 'Transcript cannot be empty'),
});

const confirmSchema = z.object({
  jobKey:          z.string().min(1, 'Job key required'),
  propertyType:    z.enum(['house', 'flat_ground', 'flat_upper', 'commercial', 'new_build']),
  urgency:         z.enum(['standard', 'next_day', 'same_day']),
  distanceMiles:   z.number().nonnegative().default(0),
  complexityFlags: z.array(z.string()).default([]),
  customerName:    z.string().default(''),
  notes:           z.string().default(''),
  includeCallOut:  z.boolean().default(false),
  confidence:      z.enum(['high', 'medium', 'low']).default('high'),
  clarificationNeeded: z.string().nullable().default(null),
});

const updateQuoteSchema = z.object({
  customerName: z.string().optional(),
  notes:        z.string().nullable().optional(),
  status:       z.enum(['draft', 'sent', 'accepted', 'declined', 'expired']).optional(),
});

const lineItemInputSchema = z.object({
  description: z.string().min(1, 'Description cannot be empty'),
  qty:         z.number().positive('Quantity must be positive'),
  unitPrice:   z.number().nonnegative('Unit price must be non-negative'),
  sortOrder:   z.number().int().nonnegative().optional(),
});

const updateLineItemsSchema = z
  .array(lineItemInputSchema)
  .min(1, 'At least one line item required');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function zodError(err: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_root';
    fields[key] = issue.message;
  }
  return { error: 'Validation failed', fields };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToQuoteHeader(row: any) {
  return {
    id:               row.id,
    traderId:         row.trader_id,
    customerName:     row.customer_name,
    customerWhatsapp: row.customer_whatsapp,
    status:           row.status,
    subtotal:         Number(row.subtotal),
    vatAmount:        Number(row.vat_amount),
    total:            Number(row.total),
    depositAmount:    Number(row.deposit_amount),
    pdfUrl:           row.pdf_url   ?? null,
    notes:            row.notes     ?? null,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToLineItem(row: any) {
  return {
    id:          row.id,
    quoteId:     row.quote_id,
    description: row.description,
    qty:         Number(row.qty),
    unitPrice:   Number(row.unit_price),
    total:       Number(row.total),
    sortOrder:   row.sort_order,
  };
}

const VALID_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'] as const;

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function quoteRoutes(fastify: FastifyInstance) {
  const db: Pool = fastify.db;
  const auth = { preHandler: [authenticate] };

  // ── POST /generate ─────────────────────────────────────────────────────────

  fastify.post('/generate', auth, async (req, reply) => {
    const parse = generateSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send(zodError(parse.error));

    const result = await generateQuote(parse.data.transcript, req.user.traderId, db);

    switch (result.status) {
      case 'needs_clarification':
        return reply.code(200).send({ status: 'needs_clarification', question: result.question });
      case 'manual_review':
        return reply.code(200).send({ status: 'manual_review', warning: result.warning });
      case 'ready':
        return reply.code(201).send({ status: 'ready', quoteId: result.quoteId });
    }
  });

  // ── POST /extract — extract fields from transcript without saving ──────────

  fastify.post('/extract', auth, async (req, reply) => {
    const parse = generateSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send(zodError(parse.error));

    const result = await extractQuoteFields(parse.data.transcript, req.user.traderId, db);

    if (result.status === 'needs_clarification') {
      return reply.code(200).send({ status: 'needs_clarification', question: result.question });
    }
    return reply.code(200).send({
      status:        'extracted',
      fields:        result.fields,
      availableJobs: result.availableJobs,
    });
  });

  // ── POST /confirm — price + save pre-confirmed fields ──────────────────────

  fastify.post('/confirm', auth, async (req, reply) => {
    const parse = confirmSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send(zodError(parse.error));

    const fields = parse.data as ExtractedFields;
    const result = await saveConfirmedQuote(fields, req.user.traderId, db);

    switch (result.status) {
      case 'needs_clarification':
        return reply.code(200).send({ status: 'needs_clarification', question: result.question });
      case 'manual_review':
        return reply.code(200).send({ status: 'manual_review', warning: result.warning });
      case 'ready':
        return reply.code(201).send({ status: 'ready', quoteId: result.quoteId });
    }
  });

  // ── GET / — paginated list, optional ?status filter ────────────────────────

  fastify.get('/', auth, async (req, reply) => {
    const { traderId } = req.user;
    const query = req.query as { status?: string; page?: string; limit?: string };

    const page   = Math.max(1, parseInt(query.page ?? '1', 10)   || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(query.limit ?? '20', 10) || 20));
    const offset = (page - 1) * limit;

    const statusFilter =
      query.status && VALID_STATUSES.includes(query.status as (typeof VALID_STATUSES)[number])
        ? query.status
        : null;

    const whereBase   = statusFilter
      ? 'WHERE trader_id = $1 AND status = $2'
      : 'WHERE trader_id = $1';
    const baseParams  = statusFilter ? [traderId, statusFilter] : [traderId];
    const nextParam   = baseParams.length + 1;

    const [countRes, rowsRes] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total FROM quotes ${whereBase}`, baseParams),
      db.query(
        `SELECT id, trader_id, customer_name, customer_whatsapp, status,
                subtotal, vat_amount, total, deposit_amount, pdf_url, notes,
                created_at, updated_at
         FROM quotes ${whereBase}
         ORDER BY created_at DESC
         LIMIT $${nextParam} OFFSET $${nextParam + 1}`,
        [...baseParams, limit, offset],
      ),
    ]);

    return reply.send({
      quotes: rowsRes.rows.map(rowToQuoteHeader),
      total:  countRes.rows[0].total,
      page,
      limit,
    });
  });

  // ── GET /:id — full quote with line items ──────────────────────────────────

  fastify.get('/:id', auth, async (req, reply) => {
    const { traderId }    = req.user;
    const { id: quoteId } = req.params as { id: string };

    const [quoteRes, itemsRes] = await Promise.all([
      db.query(
        'SELECT * FROM quotes WHERE id = $1 AND trader_id = $2',
        [quoteId, traderId],
      ),
      db.query(
        'SELECT * FROM quote_line_items WHERE quote_id = $1 ORDER BY sort_order',
        [quoteId],
      ),
    ]);

    if (!quoteRes.rows[0]) return reply.code(404).send({ error: 'Quote not found' });

    return reply.send({
      quote: {
        ...rowToQuoteHeader(quoteRes.rows[0]),
        lineItems: itemsRes.rows.map(rowToLineItem),
      },
    });
  });

  // ── PUT /:id — update customer_name, notes, status ────────────────────────

  fastify.put('/:id', auth, async (req, reply) => {
    const { traderId }    = req.user;
    const { id: quoteId } = req.params as { id: string };

    // Ownership check
    const ownerCheck = await db.query(
      'SELECT id FROM quotes WHERE id = $1 AND trader_id = $2',
      [quoteId, traderId],
    );
    if (ownerCheck.rowCount === 0) return reply.code(404).send({ error: 'Quote not found' });

    const parse = updateQuoteSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send(zodError(parse.error));
    const body = parse.data;

    if (Object.keys(body).length === 0) {
      return reply.code(400).send({ error: 'No fields provided to update' });
    }

    const colMap: Record<string, string> = {
      customerName: 'customer_name',
      notes:        'notes',
      status:       'status',
    };

    const setClauses: string[] = [];
    const values: unknown[]    = [];
    let   paramIdx             = 1;

    for (const [jsKey, pgCol] of Object.entries(colMap)) {
      if (jsKey in body) {
        setClauses.push(`${pgCol} = $${paramIdx}`);
        values.push((body as Record<string, unknown>)[jsKey]);
        paramIdx++;
      }
    }

    values.push(quoteId, traderId);
    const sql = `
      UPDATE quotes
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE id = $${paramIdx} AND trader_id = $${paramIdx + 1}
      RETURNING *`;

    const res = await db.query(sql, values);
    return reply.send({ quote: rowToQuoteHeader(res.rows[0]) });
  });

  // ── PUT /:id/line-items — full array replace, recalculate totals ───────────

  fastify.put('/:id/line-items', auth, async (req, reply) => {
    const { traderId }    = req.user;
    const { id: quoteId } = req.params as { id: string };

    // Ownership check
    const ownerCheck = await db.query(
      'SELECT id FROM quotes WHERE id = $1 AND trader_id = $2',
      [quoteId, traderId],
    );
    if (ownerCheck.rowCount === 0) return reply.code(404).send({ error: 'Quote not found' });

    const parse = updateLineItemsSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send(zodError(parse.error));
    const items = parse.data;

    // Load rate card for VAT + deposit settings
    const rcRes = await db.query(
      'SELECT vat_registered, vat_rate, deposit_percent FROM rate_cards WHERE trader_id = $1',
      [traderId],
    );
    if (!rcRes.rows[0]) return reply.code(500).send({ error: 'Rate card not found' });

    const { vat_registered, vat_rate, deposit_percent } = rcRes.rows[0];

    // Compute totals with the shared utility
    const withTotals = items.map((li, i) => ({
      ...li,
      total:     roundMoney(li.qty * li.unitPrice),
      sortOrder: li.sortOrder ?? i,
    }));

    const { subtotal, vatAmount, total, depositAmount } = calcQuoteTotals({
      lineItems: withTotals,
      rateCard: {
        vatRegistered:  Boolean(vat_registered),
        vatRate:        Number(vat_rate),
        depositPercent: Number(deposit_percent),
      },
    });

    // Replace line items + update quote totals in a transaction
    const pgClient = await db.connect();
    try {
      await pgClient.query('BEGIN');

      await pgClient.query(
        'DELETE FROM quote_line_items WHERE quote_id = $1',
        [quoteId],
      );

      for (const li of withTotals) {
        await pgClient.query(
          `INSERT INTO quote_line_items (quote_id, description, qty, unit_price, total, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [quoteId, li.description, li.qty, li.unitPrice, li.total, li.sortOrder],
        );
      }

      await pgClient.query(
        `UPDATE quotes
         SET subtotal = $1, vat_amount = $2, total = $3, deposit_amount = $4, updated_at = NOW()
         WHERE id = $5 AND trader_id = $6`,
        [subtotal, vatAmount, total, depositAmount, quoteId, traderId],
      );

      await pgClient.query('COMMIT');
    } catch (err) {
      await pgClient.query('ROLLBACK');
      throw err;
    } finally {
      pgClient.release();
    }

    // Fetch and return updated quote with new line items
    const [quoteRes, itemsRes] = await Promise.all([
      db.query('SELECT * FROM quotes WHERE id = $1', [quoteId]),
      db.query(
        'SELECT * FROM quote_line_items WHERE quote_id = $1 ORDER BY sort_order',
        [quoteId],
      ),
    ]);

    return reply.send({
      quote: {
        ...rowToQuoteHeader(quoteRes.rows[0]),
        lineItems: itemsRes.rows.map(rowToLineItem),
      },
    });
  });

  // ── DELETE /:id ─────────────────────────────────────────────────────────────

  fastify.delete('/:id', auth, async (req, reply) => {
    const { traderId }    = req.user;
    const { id: quoteId } = req.params as { id: string };

    const res = await db.query(
      'DELETE FROM quotes WHERE id = $1 AND trader_id = $2 RETURNING id',
      [quoteId, traderId],
    );
    if (res.rowCount === 0) return reply.code(404).send({ error: 'Quote not found' });
    return reply.code(204).send();
  });

  // ── GET /:id/pdf — generate PDF, upload to Azure, return SAS URL ───────────

  fastify.get('/:id/pdf', auth, async (req, reply) => {
    const { traderId }    = req.user;
    const { id: quoteId } = req.params as { id: string };

    // Load everything in parallel
    const [quoteRes, itemsRes, traderRes, rcRes] = await Promise.all([
      db.query('SELECT * FROM quotes WHERE id = $1 AND trader_id = $2', [quoteId, traderId]),
      db.query('SELECT * FROM quote_line_items WHERE quote_id = $1 ORDER BY sort_order', [quoteId]),
      db.query('SELECT name, business_name, location, whatsapp_number FROM traders WHERE id = $1', [traderId]),
      db.query('SELECT vat_registered, deposit_percent FROM rate_cards WHERE trader_id = $1', [traderId]),
    ]);

    if (!quoteRes.rows[0]) return reply.code(404).send({ error: 'Quote not found' });

    const q = quoteRes.rows[0];
    const t = traderRes.rows[0];
    const rc = rcRes.rows[0];

    const pdfData = {
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
      businessName:   t.business_name,
      traderName:     t.name,
      traderLocation: t.location,
      whatsappNumber: t.whatsapp_number ?? null,
      vatRegistered:  Boolean(rc?.vat_registered),
      depositPercent: Number(rc?.deposit_percent ?? 0),
    };

    const pdfBuffer = await generateQuotePdf(pdfData);
    const sasUrl    = await uploadQuotePdf(pdfBuffer, traderId, quoteId);

    // Persist the URL (non-fatal if it fails — client still gets the URL)
    await db.query(
      'UPDATE quotes SET pdf_url = $1, updated_at = NOW() WHERE id = $2 AND trader_id = $3',
      [sasUrl, quoteId, traderId],
    ).catch((err: unknown) => {
      fastify.log.warn({ err }, 'Failed to persist pdf_url');
    });

    return reply.send({ pdfUrl: sasUrl });
  });

  // ── POST /:id/send — generate PDF + send via WhatsApp ──────────────────────

  fastify.post('/:id/send', auth, async (req, reply) => {
    const { traderId }    = req.user;
    const { id: quoteId } = req.params as { id: string };
    const body = (req.body ?? {}) as { whatsapp?: string };

    const [quoteRes, itemsRes, traderRes, rcRes] = await Promise.all([
      db.query('SELECT * FROM quotes WHERE id = $1 AND trader_id = $2', [quoteId, traderId]),
      db.query('SELECT * FROM quote_line_items WHERE quote_id = $1 ORDER BY sort_order', [quoteId]),
      db.query('SELECT name, business_name, location, whatsapp_number FROM traders WHERE id = $1', [traderId]),
      db.query('SELECT vat_registered, deposit_percent FROM rate_cards WHERE trader_id = $1', [traderId]),
    ]);

    if (!quoteRes.rows[0]) return reply.code(404).send({ error: 'Quote not found' });

    const q  = quoteRes.rows[0];
    const t  = traderRes.rows[0];
    const rc = rcRes.rows[0];

    // Determine customer WhatsApp — explicit override, then stored value
    const customerWa = body.whatsapp ?? q.customer_whatsapp ?? '';
    if (!customerWa) {
      return reply.code(422).send({ error: 'Customer WhatsApp number required', needsWhatsapp: true });
    }

    // Generate PDF
    const pdfBuffer = await generateQuotePdf({
      id: q.id, customerName: q.customer_name, status: q.status,
      subtotal: Number(q.subtotal), vatAmount: Number(q.vat_amount),
      total: Number(q.total), depositAmount: Number(q.deposit_amount),
      notes: q.notes ?? null, createdAt: new Date(q.created_at),
      lineItems: itemsRes.rows.map((r) => ({
        description: r.description, qty: Number(r.qty),
        unitPrice: Number(r.unit_price), total: Number(r.total), sortOrder: r.sort_order,
      })),
      businessName: t.business_name, traderName: t.name, traderLocation: t.location,
      whatsappNumber: t.whatsapp_number ?? null,
      vatRegistered: Boolean(rc?.vat_registered),
      depositPercent: Number(rc?.deposit_percent ?? 0),
    });

    const sasUrl = await uploadQuotePdf(pdfBuffer, traderId, quoteId);

    // Send via WhatsApp
    const { sendMessage } = await import('../services/whatsappSender.js');
    await sendMessage(
      customerWa,
      `Hi ${q.customer_name || 'there'}! Your quote from ${t.name} is ready.\n\nTotal: £${Number(q.total).toFixed(2)}\n\nView your quote: ${sasUrl}\n\nQuote valid for 30 days.`,
    );

    // Update quote status → sent + persist WhatsApp + PDF URL
    await db.query(
      `UPDATE quotes SET status = 'sent', customer_whatsapp = $1, pdf_url = $2, updated_at = NOW()
       WHERE id = $3 AND trader_id = $4`,
      [customerWa, sasUrl, quoteId, traderId],
    );

    return reply.send({ status: 'sent', pdfUrl: sasUrl });
  });

  // ── POST /:id/corrections — log labour hour correction for calibration ──────

  fastify.post('/:id/corrections', auth, async (req, reply) => {
    const { traderId }    = req.user;
    const { id: quoteId } = req.params as { id: string };

    const ownerCheck = await db.query(
      'SELECT id FROM quotes WHERE id = $1 AND trader_id = $2',
      [quoteId, traderId],
    );
    if (ownerCheck.rowCount === 0) return reply.code(404).send({ error: 'Quote not found' });

    const body = req.body as { jobKey: string; field: string; oldValue: number; newValue: number; reason: string };

    // Store in job_library corrections (update labourHours if 3+ consistent corrections)
    const libEntry = await db.query(
      'SELECT id, labour_hours, correction_count FROM job_library WHERE trader_id = $1 AND job_key = $2',
      [traderId, body.jobKey],
    );

    if (libEntry.rows[0]) {
      const entry = libEntry.rows[0];
      const count = (entry.correction_count ?? 0) + 1;

      // After 3 corrections in the same direction, auto-update the labour hours
      if (count >= 3 && body.reason !== 'other') {
        const avg = body.newValue; // simplified — use latest correction value
        await db.query(
          `UPDATE job_library SET labour_hours = $1, correction_count = $2, is_custom = true, updated_at = NOW()
           WHERE id = $3`,
          [avg, count, entry.id],
        );
        return reply.send({ status: 'calibrated', newHours: avg, corrections: count });
      } else {
        await db.query(
          'UPDATE job_library SET correction_count = $1 WHERE id = $2',
          [count, entry.id],
        );
      }
    }

    return reply.send({ status: 'logged' });
  });
}

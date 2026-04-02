import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';
import { authenticate } from '../middleware/auth.js';

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const rateCardSchema = z.object({
  labourRate:          z.number().positive('Labour rate must be positive').optional(),
  callOutFee:          z.number().nonnegative('Call-out fee must be non-negative').optional(),
  travelRatePerMile:   z.number().nonnegative('Travel rate must be non-negative').optional(),
  markupPercent:       z.number().nonnegative('Markup must be non-negative').optional(),
  vatRegistered:       z.boolean().optional(),
  vatRate:             z.number().nonnegative('VAT rate must be non-negative').max(1, 'vatRate is a fraction (e.g. 0.20)').optional(),
  depositPercent:      z.number().nonnegative('Deposit must be non-negative').max(100, 'Deposit cannot exceed 100%').optional(),
});

const jobLibraryUpdateSchema = z.object({
  label:       z.string().min(1, 'Label cannot be empty').optional(),
  labourHours: z.number().nonnegative('Labour hours must be non-negative').optional(),
  active:      z.boolean().optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function zodError(err: z.ZodError): { error: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_root';
    fields[key] = issue.message;
  }
  return { error: 'Validation failed', fields };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTrader(row: any) {
  return {
    id:               row.id,
    name:             row.name,
    businessName:     row.business_name,
    trade:            row.trade,
    location:         row.location,
    email:            row.email,
    whatsappNumber:   row.whatsapp_number ?? null,
    stripeCustomerId: row.stripe_customer_id ?? null,
    plan:             row.plan,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRateCard(row: any) {
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
function rowToJobEntry(row: any, materials: any[]) {
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

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function traderRoutes(fastify: FastifyInstance) {
  const db: Pool = fastify.db;
  const auth = { preHandler: [authenticate] };

  // ── GET /api/trader/me ────────────────────────────────────────────────────
  fastify.get('/me', auth, async (req, reply) => {
    const { traderId } = req.user;

    const [traderRes, rcRes] = await Promise.all([
      db.query('SELECT * FROM traders WHERE id = $1', [traderId]),
      db.query('SELECT * FROM rate_cards WHERE trader_id = $1', [traderId]),
    ]);

    const trader = traderRes.rows[0];
    if (!trader) return reply.code(404).send({ error: 'Trader not found' });

    return reply.send({
      trader:   rowToTrader(trader),
      rateCard: rcRes.rows[0] ? rowToRateCard(rcRes.rows[0]) : null,
    });
  });

  // ── PUT /api/trader/rate-card ─────────────────────────────────────────────
  fastify.put('/rate-card', auth, async (req, reply) => {
    const { traderId } = req.user;

    const parse = rateCardSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send(zodError(parse.error));
    }
    const body = parse.data;

    if (Object.keys(body).length === 0) {
      return reply.code(400).send({ error: 'No fields provided to update' });
    }

    // Build SET clause dynamically from only the supplied fields
    const colMap: Record<string, string> = {
      labourRate:        'labour_rate',
      callOutFee:        'call_out_fee',
      travelRatePerMile: 'travel_rate_per_mile',
      markupPercent:     'markup_percent',
      vatRegistered:     'vat_registered',
      vatRate:           'vat_rate',
      depositPercent:    'deposit_percent',
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

    // tenant-scoped: WHERE trader_id = $N
    values.push(traderId);
    const sql = `
      UPDATE rate_cards
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE trader_id = $${paramIdx}
      RETURNING *`;

    const res = await db.query(sql, values);

    if (res.rowCount === 0) {
      // No rate_card yet — shouldn't happen after registration but handle it
      return reply.code(404).send({ error: 'Rate card not found' });
    }

    return reply.send({ rateCard: rowToRateCard(res.rows[0]) });
  });

  // ── GET /api/trader/job-library ───────────────────────────────────────────
  fastify.get('/job-library', auth, async (req, reply) => {
    const { traderId } = req.user;

    // Fetch all active entries for this trader (tenant-scoped)
    const entriesRes = await db.query(
      `SELECT * FROM job_library
       WHERE trader_id = $1 AND active = true
       ORDER BY job_key ASC`,
      [traderId],
    );

    if (entriesRes.rows.length === 0) {
      return reply.send({ jobLibrary: [] });
    }

    // Batch-fetch all materials for these entries in one query
    const entryIds = entriesRes.rows.map((r) => r.id);
    const matsRes  = await db.query(
      `SELECT * FROM job_materials
       WHERE job_library_id = ANY($1::uuid[])`,
      [entryIds],
    );

    // Group materials by job_library_id
    const matsByEntry: Record<string, typeof matsRes.rows> = {};
    for (const mat of matsRes.rows) {
      const key = mat.job_library_id;
      (matsByEntry[key] ??= []).push(mat);
    }

    const jobLibrary = entriesRes.rows.map((row) =>
      rowToJobEntry(row, matsByEntry[row.id] ?? []),
    );

    return reply.send({ jobLibrary });
  });

  // ── PUT /api/trader/job-library/:id ──────────────────────────────────────
  fastify.put('/job-library/:id', auth, async (req, reply) => {
    const { traderId }    = req.user;
    const { id: entryId } = req.params as { id: string };

    // 1. Verify ownership (tenant isolation — never query without trader_id)
    const ownerCheck = await db.query(
      'SELECT id FROM job_library WHERE id = $1 AND trader_id = $2',
      [entryId, traderId],
    );
    if (ownerCheck.rowCount === 0) {
      return reply.code(404).send({ error: 'Job library entry not found' });
    }

    // 2. Validate body
    const parse = jobLibraryUpdateSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send(zodError(parse.error));
    }
    const body = parse.data;

    if (Object.keys(body).length === 0) {
      return reply.code(400).send({ error: 'No fields provided to update' });
    }

    // 3. Build SET clause
    const colMap: Record<string, string> = {
      label:       'label',
      labourHours: 'labour_hours',
      active:      'active',
    };

    const setClauses: string[] = ['is_custom = true']; // always mark as custom on edit
    const values: unknown[]    = [];
    let   paramIdx             = 1;

    for (const [jsKey, pgCol] of Object.entries(colMap)) {
      if (jsKey in body) {
        setClauses.push(`${pgCol} = $${paramIdx}`);
        values.push((body as Record<string, unknown>)[jsKey]);
        paramIdx++;
      }
    }

    // tenant-scoped WHERE
    values.push(entryId, traderId);
    const sql = `
      UPDATE job_library
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIdx} AND trader_id = $${paramIdx + 1}
      RETURNING *`;

    const res = await db.query(sql, values);

    // Fetch updated materials for the response
    const matsRes = await db.query(
      'SELECT * FROM job_materials WHERE job_library_id = $1',
      [entryId],
    );

    return reply.send({ jobEntry: rowToJobEntry(res.rows[0], matsRes.rows) });
  });
}

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
  minimumCharge:       z.number().nonnegative('Minimum charge must be non-negative').optional(),
});

const jobLibraryUpdateSchema = z.object({
  label:       z.string().min(1, 'Label cannot be empty').optional(),
  labourHours: z.number().nonnegative('Labour hours must be non-negative').optional(),
  active:      z.boolean().optional(),
});

const materialSchema = z.object({
  item: z.string().min(1, 'Item name cannot be empty'),
  cost: z.number().nonnegative('Cost must be non-negative'),
});

const jobLibraryCreateSchema = z.object({
  jobKey:      z.string().min(1, 'Job key cannot be empty').regex(/^[a-z0-9_]+$/, 'Job key must be lowercase letters, digits, or underscores'),
  label:       z.string().min(1, 'Label cannot be empty'),
  labourHours: z.number().nonnegative('Labour hours must be non-negative'),
  materials:   z.array(materialSchema).optional().default([]),
});

const materialsReplaceSchema = z.object({
  materials: z.array(materialSchema),
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
    whatsappNumber:     row.whatsapp_number ?? null,
    stripeCustomerId:   row.stripe_customer_id ?? null,
    postcode:           row.postcode ?? null,
    plan:               row.plan,
    onboardingComplete: row.onboarding_complete ?? false,
    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
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
    minimumCharge:     Number(row.minimum_charge ?? 0),
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

  // ── PUT /api/trader/profile ──────────────────────────────────────────────
  fastify.put('/profile', auth, async (req, reply) => {
    const { traderId } = req.user;
    const profileSchema = z.object({
      name:           z.string().min(1).optional(),
      businessName:   z.string().min(1).optional(),
      trade:          z.string().min(1).optional(),
      location:       z.string().optional(),
      postcode:       z.string().nullable().optional(),
      whatsappNumber: z.string().nullable().optional(),
    });

    const parse = profileSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send(zodError(parse.error));
    const body = parse.data;

    if (Object.keys(body).length === 0) {
      return reply.code(400).send({ error: 'No fields provided to update' });
    }

    const colMap: Record<string, string> = {
      name:           'name',
      businessName:   'business_name',
      trade:          'trade',
      location:       'location',
      postcode:       'postcode',
      whatsappNumber: 'whatsapp_number',
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

    values.push(traderId);
    const res = await db.query(
      `UPDATE traders SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIdx} RETURNING *`,
      values,
    );

    return reply.send({ trader: rowToTrader(res.rows[0]) });
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
      minimumCharge:     'minimum_charge',
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

    // Fetch ALL entries (active and inactive) for this trader
    const entriesRes = await db.query(
      `SELECT * FROM job_library
       WHERE trader_id = $1
       ORDER BY is_custom ASC, job_key ASC`,
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

  // ── POST /api/trader/job-library ─────────────────────────────────────────
  fastify.post('/job-library', auth, async (req, reply) => {
    const { traderId } = req.user;

    const parse = jobLibraryCreateSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send(zodError(parse.error));
    const { jobKey, label, labourHours, materials } = parse.data;

    // Prevent duplicate jobKey per trader
    const dupCheck = await db.query(
      'SELECT id FROM job_library WHERE trader_id = $1 AND job_key = $2',
      [traderId, jobKey],
    );
    if ((dupCheck.rowCount ?? 0) > 0) {
      return reply.code(409).send({ error: `Job key "${jobKey}" already exists in your library` });
    }

    const pgClient = await db.connect();
    try {
      await pgClient.query('BEGIN');

      const insertRes = await pgClient.query(
        `INSERT INTO job_library (trader_id, job_key, label, labour_hours, is_custom, active)
         VALUES ($1, $2, $3, $4, true, true)
         RETURNING *`,
        [traderId, jobKey, label, labourHours],
      );
      const newEntry = insertRes.rows[0];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const insertedMaterials: any[] = [];
      for (const mat of materials) {
        const matRes = await pgClient.query(
          `INSERT INTO job_materials (job_library_id, item, cost)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [newEntry.id, mat.item, mat.cost],
        );
        insertedMaterials.push(matRes.rows[0]);
      }

      await pgClient.query('COMMIT');
      return reply.code(201).send({ jobEntry: rowToJobEntry(newEntry, insertedMaterials) });
    } catch (err) {
      await pgClient.query('ROLLBACK');
      throw err;
    } finally {
      pgClient.release();
    }
  });

  // ── DELETE /api/trader/job-library/:id ───────────────────────────────────
  fastify.delete('/job-library/:id', auth, async (req, reply) => {
    const { traderId }    = req.user;
    const { id: entryId } = req.params as { id: string };

    const ownerCheck = await db.query(
      'SELECT id, is_custom FROM job_library WHERE id = $1 AND trader_id = $2',
      [entryId, traderId],
    );
    if ((ownerCheck.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Job library entry not found' });
    }
    if (!ownerCheck.rows[0].is_custom) {
      return reply.code(403).send({ error: 'Only custom jobs can be deleted — disable standard jobs instead' });
    }

    // Cascade deletes materials via FK
    await db.query('DELETE FROM job_library WHERE id = $1 AND trader_id = $2', [entryId, traderId]);
    return reply.code(204).send();
  });

  // ── POST /api/trader/onboarding/complete ─────────────────────────────────
  fastify.post('/onboarding/complete', auth, async (req, reply) => {
    const { traderId } = req.user;
    const res = await db.query(
      'UPDATE traders SET onboarding_complete = true WHERE id = $1 RETURNING *',
      [traderId],
    );
    return reply.send({ trader: rowToTrader(res.rows[0]) });
  });

  // ── PUT /api/trader/job-library/:id/materials ─────────────────────────────
  // Replace all materials for a job entry in one call
  fastify.put('/job-library/:id/materials', auth, async (req, reply) => {
    const { traderId }    = req.user;
    const { id: entryId } = req.params as { id: string };

    const ownerCheck = await db.query(
      'SELECT id FROM job_library WHERE id = $1 AND trader_id = $2',
      [entryId, traderId],
    );
    if ((ownerCheck.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Job library entry not found' });
    }

    const parse = materialsReplaceSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send(zodError(parse.error));
    const { materials } = parse.data;

    const pgClient = await db.connect();
    try {
      await pgClient.query('BEGIN');

      await pgClient.query('DELETE FROM job_materials WHERE job_library_id = $1', [entryId]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const insertedMaterials: any[] = [];
      for (const mat of materials) {
        const matRes = await pgClient.query(
          `INSERT INTO job_materials (job_library_id, item, cost)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [entryId, mat.item, mat.cost],
        );
        insertedMaterials.push(matRes.rows[0]);
      }

      // Mark as custom since trader edited it
      await pgClient.query(
        'UPDATE job_library SET is_custom = true WHERE id = $1',
        [entryId],
      );

      await pgClient.query('COMMIT');

      const entryRes = await db.query('SELECT * FROM job_library WHERE id = $1', [entryId]);
      return reply.send({ jobEntry: rowToJobEntry(entryRes.rows[0], insertedMaterials) });
    } catch (err) {
      await pgClient.query('ROLLBACK');
      throw err;
    } finally {
      pgClient.release();
    }
  });
}

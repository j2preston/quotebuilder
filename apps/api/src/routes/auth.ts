import 'dotenv/config';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
const { sign } = jwt;
import Stripe from 'stripe';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { authenticate } from '../middleware/auth.js';

// ─── Stripe client (lazy — only used in register) ─────────────────────────────

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? '', { apiVersion: '2024-04-10' });
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const registerSchema = z.object({
  name:          z.string().min(1, 'Name is required'),
  businessName:  z.string().min(1, 'Business name is required'),
  trade:         z.string().min(1, 'Trade is required'),
  location:      z.string().min(1, 'Location is required'),
  email:         z.string().email('Valid email required'),
  password:      z.string().min(8, 'Password must be at least 8 characters'),
  labourRate:    z.number({ required_error: 'labourRate is required' }).positive('Labour rate must be positive'),
  vatRegistered: z.boolean({ required_error: 'vatRegistered is required' }),
});

const loginSchema = z.object({
  email:    z.string().email('Valid email required'),
  password: z.string().min(1, 'Password is required'),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format a ZodError into the { error, fields } response shape. */
function zodError(err: z.ZodError): { error: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_root';
    fields[key] = issue.message;
  }
  return { error: 'Validation failed', fields };
}

/** Sign a JWT with 24 hr expiry. */
function signToken(traderId: string, email: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return sign({ traderId, email }, secret, { expiresIn: '24h' });
}

/**
 * Bcrypt dummy hash — used when the email doesn't exist so the compare
 * still takes the same time and prevents user enumeration via timing.
 */
const DUMMY_HASH = '$2b$12$invalidhashusedfortimingsafety0000000000000000000000000';

// ─── Row mappers ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTrader(row: any) {
  return {
    id:               row.id,
    name:             row.name,
    businessName:     row.business_name,
    trade:            row.trade,
    location:         row.location,
    email:            row.email,
    whatsappNumber:      row.whatsapp_number ?? null,
    stripeCustomerId:    row.stripe_customer_id ?? null,
    postcode:            row.postcode ?? null,
    plan:                row.plan ?? 'trial',
    quotesUsedThisMonth: row.quotes_used_this_month ?? 0,
    onboardingComplete:   row.onboarding_complete ?? false,
    materialsReviewedAt:  row.materials_reviewed_at ?? null,
    createdAt:            row.created_at,
    updatedAt:            row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRateCard(row: any) {
  return {
    id:                 row.id,
    traderId:           row.trader_id,
    labourRate:         Number(row.labour_rate),
    callOutFee:         Number(row.call_out_fee),
    travelRatePerMile:  Number(row.travel_rate_per_mile),
    markupPercent:      Number(row.markup_percent),
    vatRegistered:      row.vat_registered,
    vatRate:            Number(row.vat_rate),
    depositPercent:     Number(row.deposit_percent),
    minimumCharge:        Number(row.minimum_charge ?? 0),
    defaultPropertyType:  (row.default_property_type ?? 'house') as import('@quotebot/shared').PropertyType,
    defaultUrgency:       (row.default_urgency ?? 'standard') as import('@quotebot/shared').Urgency,
    defaultDistanceMiles: Number(row.default_distance_miles ?? 0),
    updatedAt:          row.updated_at,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function authRoutes(fastify: FastifyInstance) {
  const db: Pool = fastify.db;

  // ── POST /api/auth/register ────────────────────────────────────────────────
  fastify.post('/register', async (req, reply) => {
    // 1. Validate body
    const parse = registerSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send(zodError(parse.error));
    }
    const body = parse.data;

    // 2. Check for duplicate email before hashing (fast path)
    const existing = await db.query(
      'SELECT id FROM traders WHERE email = $1',
      [body.email.toLowerCase()],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    // 3. Hash password
    const passwordHash = await bcrypt.hash(body.password, 12);

    // 4. Insert trader + rate_card + copy job templates — all in one transaction
    const client: PoolClient = await db.connect();
    let traderId: string;

    try {
      await client.query('BEGIN');

      // Insert trader
      const traderRes = await client.query(
        `INSERT INTO traders (name, business_name, trade, location, email, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [body.name, body.businessName, body.trade, body.location, body.email.toLowerCase(), passwordHash],
      );
      const traderRow = traderRes.rows[0];
      traderId = traderRow.id;

      // Insert rate_card with fixed defaults + caller-supplied labourRate / vatRegistered
      await client.query(
        `INSERT INTO rate_cards
           (trader_id, labour_rate, call_out_fee, travel_rate_per_mile,
            markup_percent, vat_registered, vat_rate, deposit_percent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [traderId, body.labourRate, 45, 0.45, 20, body.vatRegistered, 0.20, 30],
      );

      // Copy master_job_templates for this trade into job_library
      await client.query(
        `INSERT INTO job_library (trader_id, job_key, label, labour_hours, is_custom, active)
         SELECT $1, job_key, label, labour_hours, false, true
         FROM master_job_templates
         WHERE LOWER(trade) = LOWER($2)
         ON CONFLICT (trader_id, job_key) DO NOTHING`,
        [traderId, body.trade],
      );

      // Copy master_job_materials into job_materials, joined through job_library
      await client.query(
        `INSERT INTO job_materials (job_library_id, item, cost)
         SELECT jl.id, mjm.item, mjm.cost
         FROM master_job_templates mjt
         JOIN master_job_materials mjm ON mjm.template_id = mjt.id
         JOIN job_library jl
           ON jl.trader_id = $1 AND jl.job_key = mjt.job_key
         WHERE LOWER(mjt.trade) = LOWER($2)`,
        [traderId, body.trade],
      );

      await client.query('COMMIT');

      // 5. Create Stripe customer (after commit — failure here won't roll back)
      try {
        const stripe = getStripe();
        const customer = await stripe.customers.create({
          email: body.email.toLowerCase(),
          name:  body.businessName,
          metadata: { traderId },
        });
        await db.query(
          'UPDATE traders SET stripe_customer_id = $1 WHERE id = $2',
          [customer.id, traderId],
        );
        traderRow.stripe_customer_id = customer.id;
      } catch (stripeErr) {
        // Non-fatal — trader is created; stripe_customer_id stays null
        fastify.log.warn({ err: stripeErr }, 'Stripe customer creation failed');
      }

      // 6. Fetch rate card to include in response
      const rcRes = await db.query(
        'SELECT * FROM rate_cards WHERE trader_id = $1',
        [traderId],
      );

      const token = signToken(traderId, body.email.toLowerCase());

      return reply.code(201).send({
        token,
        trader:   rowToTrader(traderRow),
        rateCard: rcRes.rows[0] ? rowToRateCard(rcRes.rows[0]) : null,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // ── POST /api/auth/login ───────────────────────────────────────────────────
  fastify.post('/login', async (req, reply) => {
    const parse = loginSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send(zodError(parse.error));
    }
    const { email, password } = parse.data;

    // Always run bcrypt compare to prevent timing-based user enumeration
    const res = await db.query(
      'SELECT * FROM traders WHERE email = $1',
      [email.toLowerCase()],
    );
    const trader = res.rows[0] ?? null;
    const hashToCompare = trader?.password_hash ?? DUMMY_HASH;

    const valid = await bcrypt.compare(password, hashToCompare);
    if (!trader || !valid) {
      // Generic message — never reveal whether the email exists
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    const rcRes = await db.query(
      'SELECT * FROM rate_cards WHERE trader_id = $1',
      [trader.id],
    );

    const token = signToken(trader.id, trader.email);

    return reply.send({
      token,
      trader:   rowToTrader(trader),
      rateCard: rcRes.rows[0] ? rowToRateCard(rcRes.rows[0]) : null,
    });
  });

  // ── GET /api/auth/me ───────────────────────────────────────────────────────
  fastify.get('/me', { preHandler: [authenticate] }, async (req, reply) => {
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
}

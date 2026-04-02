import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import type { RegisterRequest, LoginRequest, AuthResponse } from '@quotebot/shared';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  businessName: z.string().min(2),
  phone: z.string().min(10),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function authRoutes(fastify: FastifyInstance) {
  // POST /auth/register
  fastify.post<{ Body: RegisterRequest }>('/register', async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const { sql } = fastify;

    const existing = await sql`SELECT id FROM traders WHERE email = ${body.email}`;
    if (existing.length > 0) {
      return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    const [trader] = await sql`
      INSERT INTO traders (email, password_hash, full_name, business_name, phone)
      VALUES (${body.email}, ${passwordHash}, ${body.fullName}, ${body.businessName}, ${body.phone})
      RETURNING id, email, full_name, business_name, phone, subscription_tier, subscription_status,
                default_vat_rate, default_markup, default_labour_rate, quote_validity_days,
                payment_terms_days, quotes_used_this_month, created_at, updated_at
    `;

    const accessToken = fastify.jwt.sign({ traderId: trader.id, email: trader.email });
    const refreshToken = await issueRefreshToken(fastify, trader.id);

    reply.code(201).send({
      accessToken,
      refreshToken,
      trader: rowToTrader(trader),
    } satisfies AuthResponse);
  });

  // POST /auth/login
  fastify.post<{ Body: LoginRequest }>('/login', async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const { sql } = fastify;

    const [trader] = await sql`
      SELECT id, email, password_hash, full_name, business_name, phone, subscription_tier,
             subscription_status, default_vat_rate, default_markup, default_labour_rate,
             quote_validity_days, payment_terms_days, quotes_used_this_month, vat_number,
             logo_url, address_line1, address_line2, city, postcode, quote_footer_text,
             whatsapp_number, stripe_customer_id, stripe_subscription_id, created_at, updated_at
      FROM traders WHERE email = ${body.email}
    `;

    if (!trader || !(await bcrypt.compare(body.password, trader.password_hash))) {
      return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid credentials' });
    }

    const accessToken = fastify.jwt.sign({ traderId: trader.id, email: trader.email });
    const refreshToken = await issueRefreshToken(fastify, trader.id);

    reply.send({ accessToken, refreshToken, trader: rowToTrader(trader) } satisfies AuthResponse);
  });

  // POST /auth/refresh
  fastify.post<{ Body: { refreshToken: string } }>('/refresh', async (req, reply) => {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) return reply.code(400).send({ message: 'refreshToken required' });

    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const { sql } = fastify;

    const [row] = await sql`
      SELECT rt.id, rt.trader_id, rt.expires_at,
             t.email, t.full_name, t.business_name, t.phone, t.subscription_tier,
             t.subscription_status, t.default_vat_rate, t.default_markup, t.default_labour_rate,
             t.quote_validity_days, t.payment_terms_days, t.quotes_used_this_month
      FROM refresh_tokens rt
      JOIN traders t ON t.id = rt.trader_id
      WHERE rt.token_hash = ${tokenHash} AND rt.expires_at > NOW()
    `;

    if (!row) {
      return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired refresh token' });
    }

    // Rotate: delete old, issue new
    await sql`DELETE FROM refresh_tokens WHERE id = ${row.id}`;
    const newAccessToken = fastify.jwt.sign({ traderId: row.trader_id, email: row.email });
    const newRefreshToken = await issueRefreshToken(fastify, row.trader_id);

    reply.send({ accessToken: newAccessToken, refreshToken: newRefreshToken, trader: rowToTrader(row) });
  });

  // POST /auth/logout
  fastify.post('/logout', {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    const { body } = req as { body: { refreshToken?: string } };
    if (body?.refreshToken) {
      const tokenHash = createHash('sha256').update(body.refreshToken).digest('hex');
      await fastify.sql`DELETE FROM refresh_tokens WHERE token_hash = ${tokenHash}`;
    }
    reply.code(204).send();
  });

  // GET /auth/me
  fastify.get('/me', {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    const { traderId } = req.user;
    const [trader] = await fastify.sql`
      SELECT id, email, full_name, business_name, phone, subscription_tier, subscription_status,
             default_vat_rate, default_markup, default_labour_rate, quote_validity_days,
             payment_terms_days, quotes_used_this_month, vat_number, logo_url, address_line1,
             address_line2, city, postcode, quote_footer_text, whatsapp_number,
             stripe_customer_id, stripe_subscription_id, created_at, updated_at
      FROM traders WHERE id = ${traderId}
    `;
    if (!trader) return reply.code(404).send({ message: 'Trader not found' });
    reply.send(rowToTrader(trader));
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function issueRefreshToken(fastify: FastifyInstance, traderId: string): Promise<string> {
  const token = randomBytes(40).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await fastify.sql`
    INSERT INTO refresh_tokens (trader_id, token_hash, expires_at)
    VALUES (${traderId}, ${tokenHash}, ${expiresAt})
  `;

  return token;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTrader(row: any) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    businessName: row.business_name,
    phone: row.phone,
    vatNumber: row.vat_number ?? undefined,
    logoUrl: row.logo_url ?? undefined,
    addressLine1: row.address_line1 ?? '',
    addressLine2: row.address_line2 ?? undefined,
    city: row.city ?? '',
    postcode: row.postcode ?? '',
    defaultVatRate: row.default_vat_rate,
    defaultMarkup: row.default_markup,
    defaultLabourRate: row.default_labour_rate,
    quoteValidityDays: row.quote_validity_days,
    paymentTermsDays: row.payment_terms_days,
    quoteFooterText: row.quote_footer_text ?? undefined,
    subscriptionTier: row.subscription_tier,
    subscriptionStatus: row.subscription_status,
    stripeCustomerId: row.stripe_customer_id ?? undefined,
    stripeSubscriptionId: row.stripe_subscription_id ?? undefined,
    whatsappNumber: row.whatsapp_number ?? undefined,
    quotesUsedThisMonth: row.quotes_used_this_month,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

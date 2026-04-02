import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const updateTraderSchema = z.object({
  fullName: z.string().min(2).optional(),
  businessName: z.string().min(2).optional(),
  phone: z.string().optional(),
  vatNumber: z.string().optional().nullable(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional(),
  postcode: z.string().optional(),
  defaultVatRate: z.number().int().min(0).max(100).optional(),
  defaultMarkup: z.number().int().min(0).max(500).optional(),
  defaultLabourRate: z.number().int().min(0).optional(),
  quoteValidityDays: z.number().int().min(1).max(365).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  quoteFooterText: z.string().max(500).optional().nullable(),
  whatsappNumber: z.string().optional().nullable(),
});

export async function traderRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  // GET /trader/profile
  fastify.get('/profile', auth, async (req, reply) => {
    const { traderId } = req.user;
    const [row] = await fastify.sql`
      SELECT id, email, full_name, business_name, phone, vat_number, logo_url,
             address_line1, address_line2, city, postcode, default_vat_rate, default_markup,
             default_labour_rate, quote_validity_days, payment_terms_days, quote_footer_text,
             subscription_tier, subscription_status, stripe_customer_id, stripe_subscription_id,
             whatsapp_number, quotes_used_this_month, created_at, updated_at
      FROM traders WHERE id = ${traderId}
    `;
    if (!row) return reply.code(404).send({ message: 'Not found' });
    reply.send(mapTrader(row));
  });

  // PATCH /trader/profile
  fastify.patch('/profile', auth, async (req, reply) => {
    const { traderId } = req.user;
    const body = updateTraderSchema.parse(req.body);

    const colMap: Record<string, string> = {
      fullName: 'full_name',
      businessName: 'business_name',
      phone: 'phone',
      vatNumber: 'vat_number',
      addressLine1: 'address_line1',
      addressLine2: 'address_line2',
      city: 'city',
      postcode: 'postcode',
      defaultVatRate: 'default_vat_rate',
      defaultMarkup: 'default_markup',
      defaultLabourRate: 'default_labour_rate',
      quoteValidityDays: 'quote_validity_days',
      paymentTermsDays: 'payment_terms_days',
      quoteFooterText: 'quote_footer_text',
      whatsappNumber: 'whatsapp_number',
    };

    const updates: Record<string, unknown> = {};
    for (const [key, col] of Object.entries(colMap)) {
      if (key in body) updates[col] = (body as Record<string, unknown>)[key] ?? null;
    }

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ message: 'No fields to update' });
    }

    await fastify.sql`
      UPDATE traders SET ${fastify.sql(updates)}, updated_at = NOW()
      WHERE id = ${traderId}
    `;

    const [row] = await fastify.sql`
      SELECT id, email, full_name, business_name, phone, vat_number, logo_url,
             address_line1, address_line2, city, postcode, default_vat_rate, default_markup,
             default_labour_rate, quote_validity_days, payment_terms_days, quote_footer_text,
             subscription_tier, subscription_status, whatsapp_number, quotes_used_this_month,
             created_at, updated_at
      FROM traders WHERE id = ${traderId}
    `;
    reply.send(mapTrader(row));
  });

  // GET /trader/customers
  fastify.get('/customers', auth, async (req, reply) => {
    const { traderId } = req.user;
    const rows = await fastify.sql`
      SELECT * FROM customers WHERE trader_id = ${traderId} ORDER BY name ASC
    `;
    reply.send(rows.map(mapCustomer));
  });

  // POST /trader/customers
  fastify.post('/customers', auth, async (req, reply) => {
    const { traderId } = req.user;
    const body = req.body as {
      name: string; email?: string; phone?: string;
      addressLine1?: string; addressLine2?: string; city?: string; postcode?: string; notes?: string;
    };

    const [row] = await fastify.sql`
      INSERT INTO customers (trader_id, name, email, phone, address_line1, address_line2, city, postcode, notes)
      VALUES (${traderId}, ${body.name}, ${body.email ?? null}, ${body.phone ?? null},
              ${body.addressLine1 ?? null}, ${body.addressLine2 ?? null}, ${body.city ?? null},
              ${body.postcode ?? null}, ${body.notes ?? null})
      RETURNING *
    `;
    reply.code(201).send(mapCustomer(row));
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTrader(row: any) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    businessName: row.business_name,
    phone: row.phone,
    vatNumber: row.vat_number,
    logoUrl: row.logo_url,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    postcode: row.postcode,
    defaultVatRate: row.default_vat_rate,
    defaultMarkup: row.default_markup,
    defaultLabourRate: row.default_labour_rate,
    quoteValidityDays: row.quote_validity_days,
    paymentTermsDays: row.payment_terms_days,
    quoteFooterText: row.quote_footer_text,
    subscriptionTier: row.subscription_tier,
    subscriptionStatus: row.subscription_status,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    whatsappNumber: row.whatsapp_number,
    quotesUsedThisMonth: row.quotes_used_this_month,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCustomer(row: any) {
  return {
    id: row.id,
    traderId: row.trader_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    postcode: row.postcode,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

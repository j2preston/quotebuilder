import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-04-10' });

export async function stripeWebhookRoutes(fastify: FastifyInstance) {
  // POST /webhooks/stripe
  // Stripe requires raw body for signature verification
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
  });

  fastify.post('/', async (req, reply) => {
    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err) {
      fastify.log.warn('Stripe webhook signature verification failed');
      return reply.code(400).send({ message: 'Webhook signature invalid' });
    }

    const { sql } = fastify;

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const tier = resolveTier(sub.items.data[0]?.price.id);
        await sql`
          UPDATE traders
          SET subscription_tier = ${tier},
              subscription_status = ${sub.status},
              stripe_subscription_id = ${sub.id}
          WHERE stripe_customer_id = ${sub.customer as string}
        `;
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await sql`
          UPDATE traders
          SET subscription_tier = 'free',
              subscription_status = 'canceled',
              stripe_subscription_id = NULL
          WHERE stripe_customer_id = ${sub.customer as string}
        `;
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await sql`
          UPDATE traders
          SET subscription_status = 'past_due'
          WHERE stripe_customer_id = ${invoice.customer as string}
        `;
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.customer && session.customer_email) {
          // Link Stripe customer to trader account
          await sql`
            UPDATE traders SET stripe_customer_id = ${session.customer as string}
            WHERE email = ${session.customer_email} AND stripe_customer_id IS NULL
          `;
        }
        break;
      }
    }

    reply.send({ received: true });
  });
}

function resolveTier(priceId?: string): 'free' | 'starter' | 'pro' {
  if (!priceId) return 'free';
  if (priceId === process.env.STRIPE_PRICE_ID_PRO) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_ID_STARTER) return 'starter';
  return 'free';
}

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { authPlugin } from './plugins/auth.js';
import { dbPlugin } from './plugins/db.js';
import { redisPlugin } from './plugins/redis.js';
import { authRoutes } from './routes/auth.js';
import { quoteRoutes } from './routes/quotes.js';
import { traderRoutes } from './routes/traders.js';
import { uploadRoutes } from './routes/uploads.js';
import { twilioWebhookRoutes } from './routes/webhooks/twilio.js';
import { stripeWebhookRoutes } from './routes/webhooks/stripe.js';

const server = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

async function bootstrap() {
  // Security
  await server.register(helmet, { contentSecurityPolicy: false });
  await server.register(cors, {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
  });
  await server.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
  });

  // Multipart (file uploads)
  await server.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  });

  // Plugins (DB, Redis, JWT)
  await server.register(dbPlugin);
  await server.register(redisPlugin);
  await server.register(authPlugin);

  // Routes
  await server.register(authRoutes, { prefix: '/auth' });
  await server.register(quoteRoutes, { prefix: '/quotes' });
  await server.register(traderRoutes, { prefix: '/trader' });
  await server.register(uploadRoutes, { prefix: '/uploads' });

  // Webhooks (no auth, but have their own verification)
  await server.register(twilioWebhookRoutes, { prefix: '/webhooks/twilio' });
  await server.register(stripeWebhookRoutes, { prefix: '/webhooks/stripe' });

  // Health check
  server.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  const port = Number(process.env.PORT ?? 3000);
  const host = '0.0.0.0';

  await server.listen({ port, host });
  server.log.info(`QuoteBot API running on port ${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});

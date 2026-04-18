import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import cron from 'node-cron';
import { dbPlugin } from './plugins/db.js';
import { redisPlugin } from './plugins/redis.js';
import { authRoutes } from './routes/auth.js';
import { traderRoutes } from './routes/traders.js';
import { quoteRoutes } from './routes/quotes.js';
import { whatsappWebhookRoutes } from './routes/webhooks/twilio.js';

const server = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    ...(process.env.NODE_ENV !== 'production' && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  },
});

async function bootstrap() {
  await server.register(cors, {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
  });

  await server.register(formbody);   // required for Twilio application/x-www-form-urlencoded

  await server.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  });

  await server.register(dbPlugin);
  await server.register(redisPlugin);

  // API routes — all under /api prefix
  await server.register(authRoutes,            { prefix: '/api/auth' });
  await server.register(traderRoutes,          { prefix: '/api/trader' });
  await server.register(quoteRoutes,           { prefix: '/api/quotes' });
  await server.register(whatsappWebhookRoutes, { prefix: '/api/webhooks/whatsapp' });

  server.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  // Reset all traders' monthly quota on the 1st of each month at 00:05 UTC.
  // The 5-minute offset avoids the exact midnight boundary where a quota check
  // and the reset could race in the same second.
  cron.schedule('5 0 1 * *', async () => {
    try {
      const result = await server.db.query(
        'UPDATE traders SET quotes_used_this_month = 0',
      );
      server.log.info({ rowsReset: result.rowCount }, 'Monthly quota reset complete');
    } catch (err) {
      server.log.error({ err }, 'Monthly quota reset failed');
    }
  }, { timezone: 'UTC' });

  const port = Number(process.env.PORT ?? 3000);
  await server.listen({ port, host: '0.0.0.0' });
  server.log.info(`QuoteBot API running on :${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});

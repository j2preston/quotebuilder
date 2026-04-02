import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { dbPlugin } from './plugins/db.js';
import { redisPlugin } from './plugins/redis.js';
import { authRoutes } from './routes/auth.js';
import { traderRoutes } from './routes/traders.js';

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

  await server.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  });

  await server.register(dbPlugin);
  await server.register(redisPlugin);

  // API routes — all under /api prefix
  await server.register(authRoutes,   { prefix: '/api/auth' });
  await server.register(traderRoutes, { prefix: '/api/trader' });

  server.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  const port = Number(process.env.PORT ?? 3000);
  await server.listen({ port, host: '0.0.0.0' });
  server.log.info(`QuoteBot API running on :${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});

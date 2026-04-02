import fp from 'fastify-plugin';
import { Pool } from 'pg';
import type { Pool as PgPool } from 'pg';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    db: PgPool;
  }
}

export const dbPlugin = fp(async (fastify: FastifyInstance) => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Verify connection on startup
  const probe = await pool.connect();
  probe.release();
  fastify.log.info('PostgreSQL connected');

  fastify.decorate('db', pool);

  fastify.addHook('onClose', async () => {
    await pool.end();
  });
});

import fp from 'fastify-plugin';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    sql: postgres.Sql;
  }
}

export const dbPlugin = fp(async (fastify: FastifyInstance) => {
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  });

  // Verify connection
  await sql`SELECT 1`;
  fastify.log.info('PostgreSQL connected');

  fastify.decorate('sql', sql);

  fastify.addHook('onClose', async () => {
    await sql.end();
  });
});

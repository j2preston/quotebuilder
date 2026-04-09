import fp from 'fastify-plugin';
import { createClient } from 'redis';
import type { FastifyInstance } from 'fastify';

type RedisClient = ReturnType<typeof createClient>;

declare module 'fastify' {
  interface FastifyInstance {
    redis: RedisClient;
  }
}

export const redisPlugin = fp(async (fastify: FastifyInstance) => {
  const client = createClient({
    url: process.env.REDIS_URL,
    socket: {
      keepAlive: 5000,
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    },
  });

  client.on('error', (err) => fastify.log.error({ err }, 'Redis error'));

  await client.connect();
  fastify.log.info('Redis connected');

  fastify.decorate('redis', client);

  fastify.addHook('onClose', async () => {
    await client.disconnect();
  });
});

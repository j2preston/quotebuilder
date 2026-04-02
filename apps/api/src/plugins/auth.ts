// Auth is handled by src/middleware/auth.ts (Bearer JWT via jsonwebtoken).
// This file is kept as a no-op plugin so the import in index.ts stays valid
// until the file is fully removed in a future cleanup.
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

export const authPlugin = fp(async (_fastify: FastifyInstance) => {
  // intentionally empty — see middleware/auth.ts
});

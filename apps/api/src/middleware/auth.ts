import jwt, { type JwtPayload as JWTPayload } from 'jsonwebtoken';
const { verify } = jwt;
import type { FastifyRequest, FastifyReply } from 'fastify';

export interface AuthUser {
  traderId: string;
  email: string;
}

// Augment FastifyRequest so route handlers get full type safety on req.user.
declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

/**
 * Fastify preHandler that enforces Bearer JWT authentication.
 *
 * On success  → attaches { traderId, email } to req.user and returns.
 * On failure  → sends 401 and returns (Fastify will not call the route handler).
 */
export async function authenticate(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET not configured');

    const decoded = verify(token, secret) as JWTPayload & AuthUser;

    if (!decoded.traderId || !decoded.email) {
      throw new Error('Invalid token payload');
    }

    req.user = { traderId: decoded.traderId, email: decoded.email };
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

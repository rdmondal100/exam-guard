import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, TEACHER_TOKEN_HEADER } from '@examguard/shared';

export interface TeacherAppOptions {
  token: string;
}

function tokenMatches(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Loopback API for the teacher UI. Every route needs the per-launch token. */
export function buildTeacherApp({ token }: TeacherAppOptions): FastifyInstance {
  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (request, reply) => {
    if (!tokenMatches(token, request.headers[TEACHER_TOKEN_HEADER])) {
      return reply
        .code(401)
        .send({ error: { code: 'unauthorized', message: 'Missing or invalid teacher token' } });
    }
    return undefined;
  });

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    protocol: PROTOCOL_VERSION,
    uptimeSec: Math.round(process.uptime()),
  }));

  return app;
}

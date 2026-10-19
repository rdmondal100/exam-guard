import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, TEACHER_TOKEN_HEADER } from '@examguard/shared';
import { AuthState } from '../auth/auth-state.js';
import { LoginLimiter } from '../auth/login-limiter.js';
import type { Db } from '../db/connection.js';
import { TeacherRepo } from '../db/teacher-repo.js';
import { registerAuthRoutes } from './auth-routes.js';
import { sendError } from './errors.js';

export interface TeacherAppOptions {
  token: string;
  db: Db;
  /** Clock for the login rate limiter and the teacher row; tests inject a fake. */
  now?: () => number;
}

export interface TeacherApp {
  app: FastifyInstance;
  /** `preHandler` for every route that needs a logged-in teacher. */
  requireLogin: AuthState['requireLogin'];
}

function tokenMatches(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Loopback API for the teacher UI. Every route needs the per-launch token; routes other than
 * `/health` and `/auth/*` also need `requireLogin`.
 */
export function buildTeacherApp({ token, db, now }: TeacherAppOptions): TeacherApp {
  const app = Fastify({ logger: false });
  const state = new AuthState();

  // The renderer is a different origin (dev server or file://), and the token header makes
  // every call a preflighted request. The preflight carries no token, so answer it before the
  // token check. The listener is loopback-only and every real call still needs the token.
  app.addHook('onRequest', async (request, reply) => {
    void reply.header('access-control-allow-origin', '*');
    if (request.method === 'OPTIONS') {
      return reply
        .header('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS')
        .header('access-control-allow-headers', `${TEACHER_TOKEN_HEADER}, content-type`)
        .header('access-control-max-age', '600')
        .code(204)
        .send();
    }
    return undefined;
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!tokenMatches(token, request.headers[TEACHER_TOKEN_HEADER])) {
      return sendError(reply, 401, 'unauthorized', 'Missing or invalid teacher token');
    }
    return undefined;
  });

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    protocol: PROTOCOL_VERSION,
    uptimeSec: Math.round(process.uptime()),
  }));

  registerAuthRoutes(app, {
    teacher: new TeacherRepo(db),
    state,
    limiter: new LoginLimiter(now),
    now,
  });

  return { app, requireLogin: state.requireLogin };
}

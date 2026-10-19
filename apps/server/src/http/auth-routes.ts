import type { FastifyInstance } from 'fastify';
import { AuthLoginBodySchema, AuthSetupBodySchema, MIN_PASSWORD_LENGTH } from '@examguard/shared';
import type { AuthState } from '../auth/auth-state.js';
import type { LoginLimiter } from '../auth/login-limiter.js';
import { hashPassword, verifyPassword } from '../auth/password-hash.js';
import type { TeacherRepo } from '../db/teacher-repo.js';
import { sendError } from './errors.js';

export interface AuthRoutesDeps {
  teacher: TeacherRepo;
  state: AuthState;
  limiter: LoginLimiter;
  now?: () => number;
}

/** `/auth/*`: first-run password setup, login, logout and the status the UI gates on. */
export function registerAuthRoutes(
  app: FastifyInstance,
  { teacher, state, limiter, now = Date.now }: AuthRoutesDeps,
): void {
  app.get('/api/v1/auth/status', async () => ({
    setupRequired: !teacher.exists(),
    loggedIn: state.isLoggedIn(),
  }));

  app.post('/api/v1/auth/setup', async (request, reply) => {
    const body = AuthSetupBodySchema.safeParse(request.body);
    if (!body.success) {
      return sendError(
        reply,
        400,
        'invalid_body',
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    if (teacher.exists()) {
      return sendError(reply, 409, 'already_setup', 'A password is already set');
    }
    const hash = await hashPassword(body.data.password);
    try {
      teacher.create(hash, now());
    } catch {
      return sendError(reply, 409, 'already_setup', 'A password is already set');
    }
    state.setLoggedIn(true);
    return { ok: true };
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = AuthLoginBodySchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 400, 'invalid_body', 'Password is required');

    const hash = teacher.getPasswordHash();
    if (hash === undefined) {
      return sendError(reply, 409, 'setup_required', 'Set a password first');
    }
    const retryAfterSec = limiter.retryAfterSec();
    if (retryAfterSec > 0) {
      return sendError(reply, 429, 'rate_limited', 'Too many attempts. Try again later.', {
        retryAfterSec,
      });
    }
    if (!(await verifyPassword(body.data.password, hash))) {
      limiter.recordFailure();
      const lockedFor = limiter.retryAfterSec();
      return sendError(
        reply,
        401,
        'bad_password',
        'Wrong password',
        lockedFor > 0 ? { retryAfterSec: lockedFor } : undefined,
      );
    }
    limiter.recordSuccess();
    state.setLoggedIn(true);
    return { ok: true };
  });

  app.post('/api/v1/auth/logout', async () => {
    state.setLoggedIn(false);
    return { ok: true };
  });
}

import type { Request, Response } from 'express';
import {
  AuthChangeBodySchema,
  AuthLoginBodySchema,
  AuthSetupBodySchema,
  MIN_PASSWORD_LENGTH,
} from '@examguard/shared';
import type { TeacherRepo } from '../db/repositories/teacher.repo.js';
import type { AuthState } from '../services/auth/auth-state.js';
import type { LoginLimiter } from '../services/auth/login-limiter.js';
import { ApiError } from '../utils/ApiError.js';
import { hashPassword, verifyPassword } from '../utils/passwordHash.js';

export interface AuthControllerDeps {
  teacher: TeacherRepo;
  state: AuthState;
  limiter: LoginLimiter;
  now?: () => number;
}

/** First-run password setup, login, logout and the status the UI gates on. */
export function createAuthController({
  teacher,
  state,
  limiter,
  now = Date.now,
}: AuthControllerDeps) {
  return {
    status(_req: Request, res: Response): void {
      res.json({ setupRequired: !teacher.exists(), loggedIn: state.isLoggedIn() });
    },

    async setup(req: Request, res: Response): Promise<void> {
      const body = AuthSetupBodySchema.safeParse(req.body);
      if (!body.success) {
        throw new ApiError(
          400,
          'invalid_body',
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        );
      }
      if (teacher.exists()) throw new ApiError(409, 'already_setup', 'A password is already set');
      const hash = await hashPassword(body.data.password);
      try {
        teacher.create(hash, now());
      } catch {
        throw new ApiError(409, 'already_setup', 'A password is already set');
      }
      state.setLoggedIn(true);
      res.json({ ok: true });
    },

    async login(req: Request, res: Response): Promise<void> {
      const body = AuthLoginBodySchema.safeParse(req.body);
      if (!body.success) throw new ApiError(400, 'invalid_body', 'Password is required');

      const hash = teacher.getPasswordHash();
      if (hash === undefined) throw new ApiError(409, 'setup_required', 'Set a password first');
      const retryAfterSec = limiter.retryAfterSec();
      if (retryAfterSec > 0) {
        throw new ApiError(429, 'rate_limited', 'Too many attempts. Try again later.', {
          retryAfterSec,
        });
      }
      if (!(await verifyPassword(body.data.password, hash))) {
        limiter.recordFailure();
        const lockedFor = limiter.retryAfterSec();
        throw new ApiError(
          401,
          'bad_password',
          'Wrong password',
          lockedFor > 0 ? { retryAfterSec: lockedFor } : undefined,
        );
      }
      limiter.recordSuccess();
      state.setLoggedIn(true);
      res.json({ ok: true });
    },

    /** M43: the logged-in teacher sets a new password; a wrong current one counts as a failed login. */
    async change(req: Request, res: Response): Promise<void> {
      const body = AuthChangeBodySchema.safeParse(req.body);
      if (!body.success) {
        throw new ApiError(
          400,
          'invalid_body',
          `The new password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        );
      }
      const hash = teacher.getPasswordHash();
      if (hash === undefined) throw new ApiError(409, 'setup_required', 'Set a password first');
      const retryAfterSec = limiter.retryAfterSec();
      if (retryAfterSec > 0) {
        throw new ApiError(429, 'rate_limited', 'Too many attempts. Try again later.', {
          retryAfterSec,
        });
      }
      if (!(await verifyPassword(body.data.currentPassword, hash))) {
        limiter.recordFailure();
        throw new ApiError(401, 'bad_password', 'The current password is wrong');
      }
      limiter.recordSuccess();
      teacher.setPasswordHash(await hashPassword(body.data.newPassword), now());
      res.json({ ok: true });
    },

    logout(_req: Request, res: Response): void {
      state.setLoggedIn(false);
      res.json({ ok: true });
    },
  };
}

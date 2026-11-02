import type { RequestHandler } from 'express';
import type { AuthState } from '../services/auth/auth-state.js';
import { sendError } from '../utils/ApiError.js';

/** Guards every teacher route except `/health` and `/auth/*`. */
export function requireLogin(state: AuthState): RequestHandler {
  return (_req, res, next) => {
    if (state.isLoggedIn()) return next();
    sendError(res, 401, 'login_required', 'Log in first');
  };
}

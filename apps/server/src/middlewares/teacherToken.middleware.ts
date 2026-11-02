import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { TEACHER_TOKEN_HEADER } from '@examguard/shared';
import { sendError } from '../utils/ApiError.js';

/** Constant-time compare of the per-launch token. */
export function tokenMatches(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Every teacher call needs the per-launch token header. It runs before routing, so unknown routes
 * answer 401 too. The `/ws` upgrade never reaches Express; the socket checks `?token=` itself.
 */
export function verifyTeacherToken(token: string): RequestHandler {
  return (req, res, next) => {
    if (tokenMatches(token, req.headers[TEACHER_TOKEN_HEADER])) return next();
    sendError(res, 401, 'unauthorized', 'Missing or invalid teacher token');
  };
}

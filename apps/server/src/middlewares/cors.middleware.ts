import type { RequestHandler } from 'express';
import { TEACHER_TOKEN_HEADER } from '@examguard/shared';

/**
 * The renderer is a different origin (dev server or file://), and the token header makes every
 * call a preflighted request. The preflight carries no token, so it is answered here, before the
 * token check. The listener is loopback-only and every real call still needs the token.
 */
export const cors: RequestHandler = (req, res, next) => {
  res.setHeader('access-control-allow-origin', '*');
  if (req.method !== 'OPTIONS') return next();
  res
    .set({
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': `${TEACHER_TOKEN_HEADER}, content-type`,
      'access-control-max-age': '600',
    })
    .status(204)
    .end();
};

import type { Response } from 'express';

/**
 * An error a controller throws to answer with a status and a code. The error middleware turns it
 * into the `{ error: { code, message, details? } }` envelope from docs/protocol.md.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Sends the error envelope. For middlewares that answer without throwing. */
export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  res.status(status).json({ error: { code, message, details } });
}

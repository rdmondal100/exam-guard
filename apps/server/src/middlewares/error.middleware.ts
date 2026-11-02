import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ApiError, sendError } from '../utils/ApiError.js';

/** Any route nobody matched. */
export const notFound: RequestHandler = (_req, res) => {
  sendError(res, 404, 'not_found', 'Not found');
};

/** The body parser's errors carry a `type` and a 4xx `status`. */
interface HttpError {
  type?: string;
  status?: number;
}

/** Turns every thrown error into the `{ error: { code, message, details? } }` envelope. */
export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof ApiError) {
    return sendError(res, err.status, err.code, err.message, err.details);
  }
  const { type, status } = (err ?? {}) as HttpError;
  if (type === 'entity.too.large') {
    return sendError(res, 413, 'payload_too_large', 'The request body is too large');
  }
  if (type === 'entity.parse.failed') {
    return sendError(res, 400, 'invalid_json', 'The request body is not valid JSON');
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return sendError(res, status, 'bad_request', 'The request is not valid');
  }
  console.error(
    `request failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
  sendError(res, 500, 'internal', 'Something went wrong on the server');
};

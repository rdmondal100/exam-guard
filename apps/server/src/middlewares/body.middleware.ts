import express, { type RequestHandler } from 'express';
import { EXAM_FILE_LIMITS } from '@examguard/shared';
import { ApiError } from '../utils/ApiError.js';

/** JSON bodies up to 1 MB, the limit for every route without its own. */
export const jsonBody: RequestHandler = express.json({ limit: '1mb' });

/** The class-list import carries a whole CSV. Mounted before `jsonBody`, which then skips. */
export const largeJsonBody: RequestHandler = express.json({ limit: '2mb' });

// One byte over the limit gets through, so the service answers with its own message.
const raw = express.raw({
  type: 'application/octet-stream',
  limit: EXAM_FILE_LIMITS.fileBytes + 1,
});

/** An exam file upload: the raw bytes as `application/octet-stream`, no base64 or multipart. */
export const rawUpload: RequestHandler = (req, res, next) => {
  raw(req, res, (err?: unknown) => {
    if ((err as { type?: string } | undefined)?.type === 'entity.too.large') {
      return next(new ApiError(413, 'file_too_large', 'That file is too large'));
    }
    next(err);
  });
};

import { z } from 'zod';
import { MAX_AUDIT_ROWS } from '@examguard/shared';

/** `GET /exams/:id/actions` query. */
export const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_AUDIT_ROWS).optional(),
});

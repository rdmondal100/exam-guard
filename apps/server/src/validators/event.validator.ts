import { z } from 'zod';
import { MAX_EVENTS_PER_PAGE, SeveritySchema } from '@examguard/shared';

/** `GET /exams/:id/events` query: the teacher's event filter. */
export const EventQuerySchema = z.object({
  studentId: z.string().min(1).optional(),
  severity: SeveritySchema.optional(),
  source: z.enum(['agent', 'app', 'server']).optional(),
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_EVENTS_PER_PAGE).default(200),
});

import { z } from 'zod';

/** Most audit rows one request returns (an exam has a few hundred at most). */
export const MAX_AUDIT_ROWS = 2000;

/**
 * One row of `teacher_actions` (M36, docs/data-model.md): what the teacher did, or what the server
 * did on its own for the exam (`terminal` running out, the exam ending at time up).
 */
export const AuditEntrySchema = z.object({
  id: z.number().int(),
  /** `message`, `warn`, `lock`, `extend_all`, `broadcast`, `end_all`, ... */
  action: z.string(),
  /** `null` for an exam-wide action. */
  examStudentId: z.string().nullable(),
  studentCode: z.string().nullable(),
  studentName: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  ts: z.number(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** `GET /exams/:id/actions`: newest first. */
export const AuditResponseSchema = z.object({ actions: z.array(AuditEntrySchema) });
export type AuditResponse = z.infer<typeof AuditResponseSchema>;

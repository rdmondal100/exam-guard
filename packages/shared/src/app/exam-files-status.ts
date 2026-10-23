import { z } from 'zod';

/**
 * How the student's copy of the teacher's exam files is going (main → renderer, M15f). `done`
 * counts files that are downloaded; `total` is the number the teacher attached.
 */
export const ExamFilesStatusSchema = z.object({
  state: z.enum(['idle', 'syncing', 'done', 'failed']),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** What went wrong, for `failed` (and for files that were skipped). */
  message: z.string().optional(),
});
export type ExamFilesStatus = z.infer<typeof ExamFilesStatusSchema>;

export const IDLE_EXAM_FILES: ExamFilesStatus = { state: 'idle', done: 0, total: 0 };

import { z } from 'zod';
import { FILE_NAME_MAX_CHARS } from './file-name.js';

/**
 * Files the teacher attaches to an exam (M15f). Every student gets a copy in their project folder,
 * so the totals are small: 200 students download them over the lab network.
 */
export const EXAM_FILE_LIMITS = {
  fileBytes: 25 * 1024 * 1024,
  totalBytes: 50 * 1024 * 1024,
  count: 50,
} as const;

/** One attached file, as the teacher lists it and as students get it in `SessionState`. */
export const ExamFileSchema = z.object({
  id: z.string().min(1).max(100),
  /** Only the length is checked here; the student's sync checks the rest (`checkFileName`). */
  name: z.string().min(1).max(FILE_NAME_MAX_CHARS),
  size: z.number().int().nonnegative().max(EXAM_FILE_LIMITS.fileBytes),
  /** Hex SHA-256 of the bytes; the student checks it after the download. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ExamFile = z.infer<typeof ExamFileSchema>;

export const ExamFilesSchema = z.array(ExamFileSchema).max(EXAM_FILE_LIMITS.count);

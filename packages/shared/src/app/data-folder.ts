import { z } from 'zod';

/** Teacher mode (M44): where the data folder is now. */
export const DataFolderInfoSchema = z.object({
  path: z.string().min(1),
  /** The profile folder (`%APPDATA%\ExamGuard`), where a new install keeps its data. */
  isDefault: z.boolean(),
});
export type DataFolderInfo = z.infer<typeof DataFolderInfoSchema>;

/**
 * Move the data folder (M44). `path` is the folder the teacher picked: used as it is when it is
 * empty or missing, else an `ExamGuard` folder is made inside it. `null` moves it back to the
 * profile folder.
 */
export const DataFolderMoveRequestSchema = z.object({
  path: z.string().min(1).max(260).nullable(),
});
export type DataFolderMoveRequest = z.infer<typeof DataFolderMoveRequestSchema>;

export const DataFolderMoveResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    path: z.string(),
    /** Old files that could not be deleted (for example a file open in another program). */
    leftBehind: z.number().int().nonnegative(),
  }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type DataFolderMoveResult = z.infer<typeof DataFolderMoveResultSchema>;

import { join } from 'node:path';

/**
 * `%LOCALAPPDATA%\ExamGuard\run\<examStudentId>`: per-run folders and the terminal workspace
 * live here (architecture §4). The id is reduced to `[A-Za-z0-9_-]` so it can't leave the root.
 */
export function runRoot(localAppData: string, examStudentId: string | null): string {
  return join(
    localAppData,
    'ExamGuard',
    'run',
    (examStudentId ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '_'),
  );
}

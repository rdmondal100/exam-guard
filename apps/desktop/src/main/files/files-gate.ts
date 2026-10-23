import type { SessionState } from '@examguard/shared';
import { examWorking } from '../exam-working.js';

/**
 * Why the Files panel may not touch the project folder now, or `null` if it may. The teacher's
 * per-exam switch (`state.filesEnabled`) is the authority.
 */
export function filesRefusal(exam: SessionState | null): string | null {
  if (!examWorking(exam)) {
    return 'The project folder is only available while the exam is running.';
  }
  if (!exam.filesEnabled) return 'The teacher has turned the Files panel off for this exam.';
  return null;
}

import type { SessionState } from '@examguard/shared';
import { examWorking } from '../exam-working.js';

/**
 * Why the terminal may not be open now, or `null` if it may. The teacher's switch
 * (`state.terminal`) is the authority; `serverNow` (local clock + offset) only backs up the
 * server's own auto-off at `until`.
 */
export function terminalRefusal(exam: SessionState | null, serverNow: number): string | null {
  if (!examWorking(exam)) return 'The terminal is only available while the exam is running.';
  const { enabled, until } = exam.terminal;
  if (!enabled || (until !== null && serverNow >= until))
    return 'The teacher has turned the terminal off.';
  return null;
}

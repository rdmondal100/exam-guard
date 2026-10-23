import type { SubmitOutcome } from '@examguard/shared';
import { remainingMs } from './examClock';
import { saveNow } from './useAutosave';

/** The student's words for why the server refused a submit. */
export function submitRefusalText(reason: string): string {
  switch (reason) {
    case 'not_running':
      return 'The exam is no longer running.';
    case 'not_working':
      return 'Your answers cannot be submitted any more.';
    case 'stopped':
      return 'The connection was closed. Try again.';
    default:
      return 'Submitting did not work. Try again.';
  }
}

/** True once the server deadline has passed, by the estimated server clock. */
export function isTimeUp(deadline: number, nowMs: number, offsetMs: number | null): boolean {
  return remainingMs(deadline, nowMs, offsetMs) === 0;
}

/**
 * Hands every changed buffer to main, then asks for the submit. IPC calls stay in order, so main
 * has the saves before the request. Settles when the server has answered (possibly after a
 * reconnect); the receipt arrives separately as `state.receipt`.
 */
export async function submitAnswers(): Promise<SubmitOutcome> {
  await saveNow('submit');
  return window.examguard.submitExam();
}

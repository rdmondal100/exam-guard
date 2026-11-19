import type { SubmitOutcome } from '@examguard/shared';
import { remainingMs } from './examClock';
import { saveNow } from '../hooks/useAutosave';

/** The student's words for why the server refused a submit. */
export function submitRefusalText(reason: string): string {
  switch (reason) {
    case 'not_running':
      return 'The exam is no longer running.';
    case 'not_working':
      return 'Your answers cannot be submitted any more.';
    case 'stopped':
      return 'The connection was closed. Try again.';
    case 'paused':
      return 'The exam is paused. Your submit is sent when it resumes.';
    case 'unauthorized':
    case 'replaced':
      return 'This session is no longer valid on this PC. Tell your invigilator.';
    case 'protocol_mismatch':
      return "This app does not match the teacher's version. Tell your invigilator.";
    case 'fingerprint_mismatch':
      return "The teacher's computer could not be verified. Tell your invigilator.";
    default:
      return 'Submitting did not work. Try again.';
  }
}

/** True once the server deadline has passed, by the estimated server clock. */
export function isTimeUp(
  deadline: number,
  nowMs: number,
  offsetMs: number | null,
  pausedAt: number | null = null,
): boolean {
  return remainingMs(deadline, nowMs, offsetMs, pausedAt) === 0;
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

import type { StudentAnswersResponse } from '@examguard/shared';
import { clockTime } from './terminalLog';

/** How often the sheet refreshes while the student is still writing (the app autosaves every 10 s). */
export const LIVE_ANSWERS_REFRESH_MS = 10_000;

/** The line under the student's name: what the teacher is looking at. */
export function answersSourceText(sheet: StudentAnswersResponse, examRunning: boolean): string {
  if (sheet.source === 'final') {
    const at = sheet.submittedAt === null ? '' : ` at ${clockTime(sheet.submittedAt)}`;
    const receipt = sheet.receiptHash ? ` · receipt ${sheet.receiptHash.slice(0, 12)}…` : '';
    return `Submitted${at}${receipt}. These are the final answers.`;
  }
  return examRunning
    ? 'Not submitted yet: the latest autosave of each answer, refreshed every 10 s.'
    : 'Not submitted: the last autosave of each answer.';
}

/** "3 of 4 answered". */
export function answeredText(sheet: StudentAnswersResponse): string {
  const answered = sheet.answers.filter((a) => a.answered).length;
  return `${answered} of ${sheet.answers.length} answered`;
}

/** Whether to poll: only the newest autosaves of a running exam can still change. */
export function refreshesLive(sheet: StudentAnswersResponse | null, examRunning: boolean): boolean {
  return examRunning && sheet?.source !== 'final';
}

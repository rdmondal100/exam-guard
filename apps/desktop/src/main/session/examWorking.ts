import type { SessionState } from '@examguard/shared';

/**
 * The student is still taking the exam: it runs and their answers are not final yet. Once they
 * submit (or are auto-submitted) the window unlocks and Run, Files and the terminal stop.
 */
export function examWorking(exam: SessionState | null): exam is SessionState {
  return (
    exam !== null &&
    exam.examState === 'running' &&
    exam.studentState !== 'submitted' &&
    exam.studentState !== 'ended_by_teacher'
  );
}

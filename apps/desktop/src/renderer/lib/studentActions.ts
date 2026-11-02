import type { ExamState, RosterEntry, StudentAction, StudentActionResult } from '@examguard/shared';

/** Which per-student actions (M35) fit this student right now; the server checks the same rules. */
export interface ActionAvailability {
  message: boolean;
  lock: boolean;
  unlock: boolean;
  extend: boolean;
  end: boolean;
  reset: boolean;
}

export function availableActions(examState: ExamState, s: RosterEntry): ActionAvailability {
  const live = examState === 'hosting' || examState === 'running';
  const running = examState === 'running';
  const final = s.state === 'submitted' || s.state === 'ended_by_teacher';
  return {
    message: live,
    lock: running && s.state === 'active',
    unlock: running && s.state === 'locked',
    extend: live && !final,
    end: running && (s.state === 'active' || s.state === 'locked'),
    reset: live,
  };
}

/** Quick extra-time choices, minutes. */
export const EXTEND_CHOICES = [5, 10, 15] as const;

/** What the teacher reads after an action went through. */
export function actionDoneText(action: StudentAction, result: StudentActionResult): string {
  const later = result.delivered ? '' : ' It will reach the student when their PC reconnects.';
  switch (action.type) {
    case 'message':
      return `${action.kind === 'warning' ? 'Warning' : 'Message'} sent.${later}`;
    case 'lock':
      return 'Screen locked.';
    case 'unlock':
      return 'Screen unlocked.';
    case 'extend':
      return `${action.minutes} minutes added.`;
    case 'end':
      return 'Exam ended for this student; their answers are final.';
    case 'reset_session':
      return 'Session reset. The student can now join again, also from another PC.';
  }
}

/** The confirmation question for actions that cannot be undone; `null` when none is needed. */
export function confirmText(action: StudentAction, s: RosterEntry): string | null {
  if (action.type === 'end') {
    return `End the exam for ${s.name} (${s.studentCode})? Their saved answers become final and they cannot continue.`;
  }
  if (action.type === 'reset_session') {
    return `Reset the session of ${s.name} (${s.studentCode})? Their app is signed out and they must join again with the PIN.`;
  }
  return null;
}

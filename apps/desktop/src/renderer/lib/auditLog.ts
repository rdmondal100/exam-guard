import type { AuditEntry } from '@examguard/shared';

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const quote = (v: unknown): string => (typeof v === 'string' && v ? `: “${v}”` : '');

/** Who an action was for: the student, or the whole exam. */
export function auditTarget(entry: AuditEntry): string {
  if (!entry.examStudentId) return 'Everyone';
  if (entry.studentCode) return `${entry.studentCode} ${entry.studentName ?? ''}`.trim();
  return 'A removed student';
}

/** One line in the teacher's words for a `teacher_actions` row (M36). Unknown kinds show raw. */
export function describeAudit(entry: AuditEntry): string {
  const p = entry.payload;
  switch (entry.action) {
    case 'host':
      return 'Started hosting';
    case 'stop_hosting':
      return 'Stopped hosting';
    case 'start':
      return 'Started the exam';
    case 'end_all':
      return p.reason === 'time_up' ? 'The exam ended at time up' : 'Ended the exam for everyone';
    case 'extend_all':
      return `Added ${num(p.minutes) ?? '?'} minutes for everyone`;
    case 'broadcast': {
      const sent = num(p.sent);
      const to = sent === null ? '' : ` to ${sent} student${sent === 1 ? '' : 's'}`;
      return `${p.kind === 'warning' ? 'Warning' : 'Message'}${to}${quote(p.text)}`;
    }
    case 'message':
      return `Message${quote(p.text)}`;
    case 'warn':
      return `Warning${quote(p.text)}`;
    case 'lock':
      return 'Locked the screen';
    case 'unlock':
      return 'Unlocked the screen';
    case 'extend':
      return `Added ${num(p.minutes) ?? '?'} minutes`;
    case 'end':
      return 'Ended the exam for this student';
    case 'reset_session':
      return 'Reset the session';
    case 'terminal': {
      if (p.reason === 'time_up') return 'The terminal window ran out';
      if (p.enabled !== true) return 'Turned the terminal off';
      const minutes = num(p.minutes);
      return minutes === null
        ? 'Turned the terminal on'
        : `Turned the terminal on for ${minutes} minutes`;
    }
    case 'internet':
      return p.enabled === true ? 'Allowed the internet' : 'Blocked the internet';
    default:
      return `${entry.action} ${JSON.stringify(p)}`;
  }
}

/** Actions the server wrote by itself (time up), shown in a quieter style. */
export function isServerAction(entry: AuditEntry): boolean {
  return (
    (entry.action === 'end_all' || entry.action === 'terminal') &&
    entry.payload.reason === 'time_up'
  );
}

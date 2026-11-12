import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '@examguard/shared';
import { auditTarget, describeAudit, isServerAction } from './auditLog';

const row = (
  action: string,
  payload: Record<string, unknown> = {},
  student = false,
): AuditEntry => ({
  id: 1,
  action,
  examStudentId: student ? 's1' : null,
  studentCode: student ? '7' : null,
  studentName: student ? 'Ada' : null,
  payload,
  ts: 1,
});

describe('describeAudit', () => {
  it.each([
    [row('host'), 'Started hosting'],
    [row('start'), 'Started the exam'],
    [row('end_all', { reason: 'manual' }), 'Ended the exam for everyone'],
    [row('end_all', { reason: 'time_up' }), 'The exam ended at time up'],
    [row('extend_all', { minutes: 10 }), 'Added 10 minutes for everyone'],
    [row('broadcast', { kind: 'info', text: 'Hi', sent: 1 }), 'Message to 1 student: “Hi”'],
    [
      row('broadcast', { kind: 'warning', text: 'Quiet', sent: 30 }),
      'Warning to 30 students: “Quiet”',
    ],
    [row('warn', { text: 'Stop' }, true), 'Warning: “Stop”'],
    [row('extend', { minutes: 5 }, true), 'Added 5 minutes'],
    [row('terminal', { enabled: true, minutes: 30 }), 'Turned the terminal on for 30 minutes'],
    [row('terminal', { enabled: false, reason: 'time_up' }), 'The terminal window ran out'],
    [row('internet', { enabled: false }), 'Blocked the internet'],
    [row('grade_edit', { q: 1 }), 'grade_edit {"q":1}'],
  ])('case %#', (entry, text) => {
    expect(describeAudit(entry)).toBe(text);
  });
});

describe('auditTarget and isServerAction', () => {
  it('names the student or everyone', () => {
    expect(auditTarget(row('lock', {}, true))).toBe('7 Ada');
    expect(auditTarget(row('extend_all', { minutes: 1 }))).toBe('Everyone');
    expect(auditTarget({ ...row('lock'), examStudentId: 'gone' })).toBe('A removed student');
  });

  it('marks what the server did by itself', () => {
    expect(isServerAction(row('end_all', { reason: 'time_up' }))).toBe(true);
    expect(isServerAction(row('end_all', { reason: 'manual' }))).toBe(false);
    expect(isServerAction(row('lock', {}, true))).toBe(false);
  });
});

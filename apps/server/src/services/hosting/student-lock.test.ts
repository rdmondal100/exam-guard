import { describe, expect, it } from 'vitest';
import type { ExamState, LockReason, ServerToStudent } from '@examguard/shared';
import type { ExamStudent } from '../../db/repositories/examStudent.repo.js';
import { StudentLock } from './student-lock.js';

function setup(examState: ExamState = 'running', state: ExamStudent['state'] = 'active') {
  const student: ExamStudent = {
    id: 's1',
    examId: 'e1',
    classStudentId: 'c1',
    state,
    tokenHash: null,
    deviceId: null,
    lockReason: null,
  };
  const sent: ServerToStudent[] = [];
  const changed: string[] = [];
  const lock = new StudentLock({
    students: {
      findById: (id) => (id === student.id ? student : undefined),
      lock: (_id, reason: LockReason) =>
        student.state === 'active'
          ? ((student.state = 'locked'), (student.lockReason = reason), true)
          : false,
      unlock: () => (student.state === 'locked' ? ((student.state = 'active'), true) : false),
    },
    hub: { sendTo: (_id, m) => sent.push(m), changed: (id) => changed.push(id) },
    examState: (id) => (id === 'e1' ? examState : undefined),
  });
  return { lock, student, sent, changed };
}

describe('StudentLock', () => {
  it('locks an active student of a running exam once and tells them why', () => {
    const t = setup();
    t.lock.agentLost('s1');
    t.lock.agentLost('s1');
    expect(t.student.state).toBe('locked');
    expect(t.sent).toEqual([
      { t: 'state', state: { studentState: 'locked', locked: true, lockReason: 'agent' } },
    ]);
    expect(t.changed).toEqual(['s1']);
  });

  it('leaves a student alone outside a running exam or after submitting', () => {
    const hosting = setup('hosting', 'lobby');
    hosting.lock.agentLost('s1');
    expect(hosting.sent).toEqual([]);
    const submitted = setup('running', 'submitted');
    expect(submitted.lock.lock('s1', 'teacher')).toBe(false);
    expect(submitted.student.state).toBe('submitted');
    setup().lock.agentLost('unknown');
  });

  it('locks for the teacher and unlocks, pushing each state', () => {
    const t = setup();
    expect(t.lock.lock('s1', 'teacher')).toBe(true);
    expect(t.lock.unlock('s1')).toBe(true);
    expect(t.lock.unlock('s1')).toBe(false);
    expect(t.sent).toEqual([
      { t: 'state', state: { studentState: 'locked', locked: true, lockReason: 'teacher' } },
      { t: 'state', state: { studentState: 'active', locked: false, lockReason: null } },
    ]);
  });

  it('does not unlock outside a running exam or for an unknown student', () => {
    expect(setup('ended', 'locked').lock.unlock('s1')).toBe(false);
    expect(setup('running', 'locked').lock.unlock('x')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { ExamState, ServerToStudent } from '@examguard/shared';
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
  };
  const sent: ServerToStudent[] = [];
  const changed: string[] = [];
  const actions: string[] = [];
  const lock = new StudentLock({
    students: {
      findById: (id) => (id === student.id ? student : undefined),
      lock: () => (student.state === 'active' ? ((student.state = 'locked'), true) : false),
      unlock: () => (student.state === 'locked' ? ((student.state = 'active'), true) : false),
    },
    actions: { insert: (a) => actions.push(`${a.action} ${a.examStudentId}`) },
    hub: { sendTo: (_id, m) => sent.push(m), changed: (id) => changed.push(id) },
    examState: (id) => (id === 'e1' ? examState : undefined),
    now: () => 7,
  });
  return { lock, student, sent, changed, actions };
}

describe('StudentLock', () => {
  it('locks an active student of a running exam once and tells them', () => {
    const t = setup();
    t.lock.agentLost('s1');
    t.lock.agentLost('s1');
    expect(t.student.state).toBe('locked');
    expect(t.sent).toEqual([{ t: 'state', state: { studentState: 'locked', locked: true } }]);
    expect(t.changed).toEqual(['s1']);
  });

  it('leaves a student alone outside a running exam or after submitting', () => {
    const hosting = setup('hosting', 'lobby');
    hosting.lock.agentLost('s1');
    expect(hosting.sent).toEqual([]);
    const submitted = setup('running', 'submitted');
    submitted.lock.agentLost('s1');
    expect(submitted.student.state).toBe('submitted');
    setup().lock.agentLost('unknown');
  });

  it('unlocks a locked student, logs it and pushes the state', () => {
    const t = setup('running', 'locked');
    expect(t.lock.unlock('e1', 's1')).toEqual({ ok: true, studentState: 'active' });
    expect(t.actions).toEqual(['unlock s1']);
    expect(t.sent).toEqual([{ t: 'state', state: { studentState: 'active', locked: false } }]);
  });

  it('refuses an unknown exam or student (404) and a student who is not locked (409)', () => {
    const t = setup();
    expect(() => t.lock.unlock('nope', 's1')).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => t.lock.unlock('e1', 'x')).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => t.lock.unlock('e1', 's1')).toThrow(expect.objectContaining({ status: 409 }));
    expect(t.actions).toEqual([]);
  });
});

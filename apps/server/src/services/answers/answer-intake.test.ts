import { describe, expect, it } from 'vitest';
import type { AnswerSave } from '@examguard/shared';
import { dropReason } from './answer-intake.js';

const DEADLINE = 1_000_000;
const GRACE = 60_000;

function deps(over: { examState?: string; studentState?: string | undefined; now?: number } = {}) {
  return {
    exams: { get: () => ({ state: over.examState ?? 'running' }) },
    students: {
      findById: () =>
        'studentState' in over && over.studentState === undefined
          ? undefined
          : { state: over.studentState ?? 'active' },
    },
    questions: {
      get: (id: string) =>
        id === 'q1'
          ? { id, examId: 'e1', type: 'code', allowedLanguages: ['c'] }
          : id === 'q2'
            ? { id, examId: 'e1', type: 'written', allowedLanguages: [] }
            : undefined,
    },
    deadlines: { forStudent: () => DEADLINE, graceMs: () => GRACE },
    now: () => over.now ?? DEADLINE - 1000,
  } as unknown as Parameters<typeof dropReason>[0];
}

const save = (over: Partial<AnswerSave> = {}): AnswerSave => ({
  t: 'answer.save',
  id: 's1',
  clientSeq: 1,
  clientTs: DEADLINE - 2000,
  questionId: 'q1',
  language: 'c',
  content: 'x',
  selected: true,
  reason: 'interval',
  ...over,
});

describe('dropReason', () => {
  it('accepts a normal save', () => {
    expect(dropReason(deps(), 'e1', 's', save())).toBeNull();
  });

  it('drops a save when the exam is not running', () => {
    expect(dropReason(deps({ examState: 'ended' }), 'e1', 's', save())).toBe('exam_not_running');
  });

  it.each(['submitted', 'ended_by_teacher', 'lobby', 'not_joined'])(
    'drops a save from a student in state %s',
    (studentState) => {
      expect(dropReason(deps({ studentState }), 'e1', 's', save())).toBe('student_not_working');
    },
  );

  it('accepts a save from a locked student', () => {
    expect(dropReason(deps({ studentState: 'locked' }), 'e1', 's', save())).toBeNull();
  });

  it('drops a save from an unknown student', () => {
    expect(dropReason(deps({ studentState: undefined }), 'e1', 's', save())).toBe(
      'student_not_working',
    );
  });

  it('accepts a save made before the deadline that arrives inside the grace', () => {
    expect(
      dropReason(deps({ now: DEADLINE + GRACE - 1 }), 'e1', 's', save({ clientTs: DEADLINE - 1 })),
    ).toBeNull();
    expect(
      dropReason(deps({ now: DEADLINE + 5000 }), 'e1', 's', save({ clientTs: DEADLINE })),
    ).toBeNull();
  });

  it('drops a save stamped after the deadline', () => {
    expect(
      dropReason(deps({ now: DEADLINE + 1000 }), 'e1', 's', save({ clientTs: DEADLINE + 1 })),
    ).toBe('after_deadline');
  });

  it('drops a save that arrives after the grace, however it is stamped', () => {
    expect(dropReason(deps({ now: DEADLINE + GRACE + 1 }), 'e1', 's', save({ clientTs: 5 }))).toBe(
      'past_grace',
    );
  });

  it('keeps the question and language rules', () => {
    expect(dropReason(deps(), 'e1', 's', save({ questionId: 'nope' }))).toBe('unknown_question');
    expect(dropReason(deps(), 'e2', 's', save())).toBe('unknown_question');
    expect(dropReason(deps(), 'e1', 's', save({ language: 'cpp' }))).toBe('language_not_allowed');
    expect(dropReason(deps(), 'e1', 's', save({ questionId: 'q2', language: 'text' }))).toBeNull();
  });
});

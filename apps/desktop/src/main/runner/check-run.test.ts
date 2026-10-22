import { describe, expect, it } from 'vitest';
import type { RunRequest, SessionState } from '@examguard/shared';
import { runRefusal } from './check-run.js';

const exam: SessionState = {
  examState: 'running',
  studentState: 'active',
  deadline: 1,
  saved: [],
  locked: false,
  monitoring: false,
  terminal: { enabled: false, until: null },
  questions: [
    {
      id: 'q1',
      position: 1,
      type: 'code',
      body: 'x',
      marks: 1,
      allowedLanguages: ['c', 'js'],
      studentNote: '',
    },
    {
      id: 'q2',
      position: 2,
      type: 'written',
      body: 'y',
      marks: 1,
      allowedLanguages: [],
      studentNote: '',
    },
  ],
};
const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  questionId: 'q1',
  language: 'c',
  code: '',
  stdin: '',
  ...over,
});

describe('runRefusal', () => {
  it('allows an allowed language on a code question of a running exam', () => {
    expect(runRefusal(exam, req())).toBeNull();
    expect(runRefusal(exam, req({ language: 'js' }))).toBeNull();
  });

  it.each([
    ['no session', null, req()],
    ['exam not running', { ...exam, examState: 'ended' as const }, req()],
    ['unknown question', exam, req({ questionId: 'nope' })],
    ['written question', exam, req({ questionId: 'q2' })],
    ['language not allowed', exam, req({ language: 'cpp' })],
  ])('refuses: %s', (_name, state, request) => {
    expect(runRefusal(state, request)).toEqual(expect.any(String));
  });
});

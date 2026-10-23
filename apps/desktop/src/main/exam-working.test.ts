import { describe, expect, it } from 'vitest';
import type { SessionState } from '@examguard/shared';
import { examWorking } from './exam-working.js';
import { filesRefusal } from './files/files-gate.js';
import { terminalRefusal } from './terminal/terminal-gate.js';

const state = (over: Partial<SessionState>): SessionState => ({
  examState: 'running',
  studentState: 'active',
  deadline: 1,
  saved: [],
  locked: false,
  monitoring: false,
  terminal: { enabled: true, until: null },
  filesEnabled: true,
  examFiles: [],
  ...over,
});

describe('examWorking', () => {
  it('is true while the exam runs and the student has not finished', () => {
    expect(examWorking(state({}))).toBe(true);
    expect(examWorking(state({ studentState: 'locked' }))).toBe(true);
  });

  it('is false before the exam, after it, and once the answers are final', () => {
    expect(examWorking(null)).toBe(false);
    expect(examWorking(state({ examState: 'hosting', studentState: 'lobby' }))).toBe(false);
    expect(examWorking(state({ examState: 'ended' }))).toBe(false);
    expect(examWorking(state({ studentState: 'submitted' }))).toBe(false);
    expect(examWorking(state({ studentState: 'ended_by_teacher' }))).toBe(false);
  });

  it('stops the terminal and the project folder after a submit', () => {
    expect(terminalRefusal(state({}), 0)).toBeNull();
    expect(terminalRefusal(state({ studentState: 'submitted' }), 0)).not.toBeNull();
    expect(filesRefusal(state({}))).toBeNull();
    expect(filesRefusal(state({ studentState: 'submitted' }))).not.toBeNull();
  });
});

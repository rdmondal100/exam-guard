import { describe, expect, it } from 'vitest';
import type { SessionState } from '@examguard/shared';
import { filesRefusal } from './files-gate.js';

const state = (patch: Partial<SessionState>): SessionState => ({
  examState: 'running',
  studentState: 'active',
  deadline: 1,
  saved: [],
  locked: false,
  monitoring: false,
  terminal: { enabled: false, until: null },
  filesEnabled: true,
  examFiles: [],
  ...patch,
});

describe('filesRefusal', () => {
  it('allows the panel while the exam runs with Files on', () => {
    expect(filesRefusal(state({}))).toBeNull();
  });

  it('refuses before the exam runs, after it ends, and with no session', () => {
    expect(filesRefusal(state({ examState: 'hosting' }))).toMatch(/only available/);
    expect(filesRefusal(state({ examState: 'ended' }))).toMatch(/only available/);
    expect(filesRefusal(null)).toMatch(/only available/);
  });

  it('refuses when the teacher turned Files off', () => {
    expect(filesRefusal(state({ filesEnabled: false }))).toMatch(/teacher/);
  });
});

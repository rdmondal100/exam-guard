import { describe, expect, it } from 'vitest';
import type { SessionState } from '@examguard/shared';
import { terminalEnabled, terminalRefusal } from './terminal-gate.js';

const exam = (examState: SessionState['examState']) => ({ examState }) as SessionState;

describe('terminalEnabled', () => {
  it('is a dev-only switch until the teacher toggle (M15b)', () => {
    expect(terminalEnabled(false, { EG_TERMINAL: '1' })).toBe(true);
    expect(terminalEnabled(false, {})).toBe(false);
    expect(terminalEnabled(true, { EG_TERMINAL: '1' })).toBe(false);
  });
});

describe('terminalRefusal', () => {
  it('allows only a running exam with the terminal on', () => {
    expect(terminalRefusal(exam('running'), true)).toBeNull();
    expect(terminalRefusal(exam('running'), false)).toMatch(/turned off/);
    expect(terminalRefusal(exam('hosting'), true)).toMatch(/while the exam is running/);
    expect(terminalRefusal(exam('ended'), true)).toMatch(/while the exam is running/);
    expect(terminalRefusal(null, true)).toMatch(/while the exam is running/);
  });
});

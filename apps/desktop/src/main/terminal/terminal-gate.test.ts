import { describe, expect, it } from 'vitest';
import type { SessionState } from '@examguard/shared';
import { terminalRefusal } from './terminal-gate.js';

const exam = (
  examState: SessionState['examState'],
  terminal: SessionState['terminal'] = { enabled: true, until: null },
) => ({ examState, terminal }) as SessionState;

describe('terminalRefusal', () => {
  it('allows only a running exam with the teacher switch on', () => {
    expect(terminalRefusal(exam('running'), 0)).toBeNull();
    expect(terminalRefusal(exam('running', { enabled: false, until: null }), 0)).toMatch(
      /turned the terminal off/,
    );
    expect(terminalRefusal(exam('hosting'), 0)).toMatch(/while the exam is running/);
    expect(terminalRefusal(exam('ended'), 0)).toMatch(/while the exam is running/);
    expect(terminalRefusal(null, 0)).toMatch(/while the exam is running/);
  });

  it('closes at the end of an "N minutes" window by server time', () => {
    const timed = exam('running', { enabled: true, until: 1_000 });
    expect(terminalRefusal(timed, 999)).toBeNull();
    expect(terminalRefusal(timed, 1_000)).toMatch(/turned the terminal off/);
  });
});

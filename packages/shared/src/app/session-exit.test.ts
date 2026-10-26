import { describe, expect, it } from 'vitest';
import { sessionExit } from './session-exit.js';

const exam = { deadline: 100_000, graceSec: 60 };

describe('sessionExit', () => {
  it('is null while connected, however late', () => {
    expect(sessionExit(exam, { link: 'connected', offsetMs: 0 }, 10_000_000)).toBeNull();
  });

  it('reports a failed session at once', () => {
    expect(sessionExit(exam, { link: 'failed', offsetMs: null }, 0)).toBe('session_failed');
  });

  it('waits for deadline + grace + slack when the link is down', () => {
    const status = { link: 'reconnecting', offsetMs: 0 } as const;
    expect(sessionExit(exam, status, 100_000 + 65_000)).toBeNull();
    expect(sessionExit(exam, status, 100_000 + 65_001)).toBe('exam_over');
  });

  it('applies the server clock offset and defaults the grace to 60 s', () => {
    const status = { link: 'connecting', offsetMs: 10_000 } as const;
    expect(sessionExit({ deadline: 100_000 }, status, 100_000 + 55_000)).toBeNull();
    expect(sessionExit({ deadline: 100_000 }, status, 100_000 + 55_001)).toBe('exam_over');
  });

  it('is null without a deadline', () => {
    expect(sessionExit({ deadline: null }, { link: 'reconnecting', offsetMs: 0 }, 1e12)).toBeNull();
  });
});

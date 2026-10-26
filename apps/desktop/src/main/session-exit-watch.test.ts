import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionState, SessionStatus } from '@examguard/shared';
import { SessionExitWatch } from './session-exit-watch.js';

const DEADLINE = 1_000_000;

function exam(over: Partial<SessionState> = {}): SessionState {
  return {
    examState: 'running',
    studentState: 'active',
    deadline: DEADLINE,
    graceSec: 60,
    saved: [],
    locked: false,
    monitoring: false,
    terminal: { enabled: false, until: null },
    internet: 'open',
    filesEnabled: true,
    examFiles: [],
    ...over,
  } as SessionState;
}

const down: SessionStatus = { link: 'reconnecting', offsetMs: 0 };

afterEach(() => vi.useRealTimers());

function setup(now: () => number) {
  const release = vi.fn();
  const watch = new SessionExitWatch({ release, now });
  return { release, watch };
}

describe('SessionExitWatch', () => {
  it('keeps the lock while the link is down before deadline + grace', () => {
    const { release, watch } = setup(() => DEADLINE + 30_000);
    watch.setExam(exam());
    watch.setStatus(down);
    expect(release).not.toHaveBeenCalled();
    watch.stop();
  });

  it('releases once the link is down past deadline + grace', () => {
    vi.useFakeTimers();
    let now = DEADLINE - 10_000;
    const { release, watch } = setup(() => now);
    watch.setExam(exam());
    watch.setStatus(down);
    expect(release).not.toHaveBeenCalled();
    now = DEADLINE + 60_000 + 5_001;
    vi.advanceTimersByTime(1000);
    expect(release).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases at once when the session failed for good', () => {
    const { release, watch } = setup(() => 0);
    watch.setExam(exam());
    watch.setStatus({ link: 'failed', offsetMs: null, reason: 'replaced' });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does nothing while connected or once the student is submitted', () => {
    const { release, watch } = setup(() => DEADLINE + 10_000_000);
    watch.setExam(exam());
    watch.setStatus({ link: 'connected', offsetMs: 0 });
    watch.setExam(exam({ studentState: 'submitted' }));
    watch.setStatus(down);
    expect(release).not.toHaveBeenCalled();
  });

  it('stops checking when the link comes back', () => {
    vi.useFakeTimers();
    let now = DEADLINE;
    const { release, watch } = setup(() => now);
    watch.setExam(exam());
    watch.setStatus(down);
    watch.setStatus({ link: 'connected', offsetMs: 0 });
    now = DEADLINE + 10_000_000;
    vi.advanceTimersByTime(5000);
    expect(release).not.toHaveBeenCalled();
  });
});

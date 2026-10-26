import { sessionExit, type SessionState, type SessionStatus } from '@examguard/shared';
import { examWorking } from './exam-working.js';

export interface SessionExitWatchDeps {
  /** Lets go of the exam lock (the window can be closed and leaves fullscreen). */
  release: () => void;
  now?: () => number;
  tickMs?: number;
}

/**
 * Releases the exam lock when the student can no longer continue: the session failed for good, or
 * the link is down past their deadline plus grace (see `sessionExit`). While the link is down the
 * clock keeps running with no event to wake us, so a timer re-checks once a second until the link
 * is back, the exam state changes or the lock is released.
 */
export class SessionExitWatch {
  private exam: SessionState | null = null;
  private status: SessionStatus | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: SessionExitWatchDeps) {}

  setExam(exam: SessionState): void {
    this.exam = exam;
    this.check();
  }

  setStatus(status: SessionStatus): void {
    this.status = status;
    this.check();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private check(): void {
    const { exam, status } = this;
    if (!exam || !status || !examWorking(exam) || status.link === 'connected') return this.stop();
    if (sessionExit(exam, status, (this.deps.now ?? Date.now)())) {
      this.stop();
      return this.deps.release();
    }
    this.timer ??= setInterval(() => this.check(), this.deps.tickMs ?? 1000);
  }
}

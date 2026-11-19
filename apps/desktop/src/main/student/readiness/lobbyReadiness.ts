import type { ReadinessReport, SessionState } from '@examguard/shared';

/** A failed check is tried again at the next welcome, but not more often than this. */
export const RETRY_AFTER_MS = 60_000;

export interface LobbyReadinessDeps {
  run: () => Promise<ReadinessReport>;
  /** The result goes to the server (roster) and to the lobby screen. */
  publish: (report: ReadinessReport) => void;
  now?: () => number;
}

/**
 * When the lobby readiness check runs (M54): once the student is in the lobby of a hosted exam,
 * and again (after a pause) only while the last result had a problem. A new session starts over.
 */
export class LobbyReadiness {
  private last: ReadinessReport | null = null;
  private lastRunAt = 0;
  private running = false;
  private readonly now: () => number;

  constructor(private readonly deps: LobbyReadinessDeps) {
    this.now = deps.now ?? Date.now;
  }

  current(): ReadinessReport | null {
    return this.last;
  }

  onExam(exam: SessionState): void {
    if (exam.examState !== 'hosting' || this.running) return;
    if (this.last) {
      if (this.last.checks.every((c) => c.ok)) return;
      if (this.now() - this.lastRunAt < RETRY_AFTER_MS) return;
    }
    this.running = true;
    this.lastRunAt = this.now();
    void this.deps
      .run()
      .then((report) => {
        this.last = report;
        this.deps.publish(report);
      })
      .catch(() => undefined)
      .finally(() => {
        this.running = false;
      });
  }

  reset(): void {
    this.last = null;
    this.lastRunAt = 0;
  }
}

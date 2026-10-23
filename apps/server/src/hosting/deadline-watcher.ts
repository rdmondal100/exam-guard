import type { StudentDeadlines } from '../exams/student-deadlines.js';
import type { SubmissionService } from '../submissions/submission-service.js';

export interface DeadlineWatcherDeps {
  deadlines: StudentDeadlines;
  submissions: Pick<SubmissionService, 'finalize'>;
  /** Called every tick, for the terminal switch's backstop. */
  onTick: (examId: string) => void;
  /** Ends the exam once the last deadline plus the grace has passed. */
  endExam: (examId: string) => Promise<void>;
  now: () => number;
  tickMs?: number;
}

/**
 * Once a second: auto-submits every working student whose own deadline plus grace has passed, and
 * ends the exam when the last one has. A tick right after a restart handles deadlines that passed
 * while the server was down.
 */
export class DeadlineWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: DeadlineWatcherDeps) {}

  start(examId: string): void {
    this.stop();
    this.timer = setInterval(() => this.tick(examId), this.deps.tickMs ?? 1000);
    this.timer.unref();
    this.tick(examId);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(examId: string): void {
    const { deadlines, submissions, onTick, endExam, now } = this.deps;
    const last = deadlines.last(examId);
    if (last === null) return;
    onTick(examId);
    for (const studentId of deadlines.overdue(examId, now())) {
      submissions.finalize(studentId, 'time_up');
    }
    if (now() < last + deadlines.graceMs(examId)) return;
    endExam(examId).catch(() => this.stop());
  }
}

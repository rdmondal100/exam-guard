import type { ExamRepo } from '../db/exam-repo.js';
import type { ExamStudentRepo } from '../db/exam-student-repo.js';
import { computeDeadline } from './deadline.js';

/**
 * Per-student deadlines and the time-up grace (docs/architecture.md §6). There is no stored
 * "ending" state: a student is ending between `deadline` and `deadline + grace`, and everything
 * here is recomputed from the stored start time, so a server restart changes nothing.
 */
export class StudentDeadlines {
  constructor(
    private readonly exams: ExamRepo,
    private readonly students: ExamStudentRepo,
  ) {}

  /** One student's deadline (a personal extension counts); `null` studentId = no extension. */
  forStudent(examId: string, studentId: string | null): number | null {
    const timing = this.exams.timing(examId);
    if (!timing || timing.startedAt === null) return null;
    return computeDeadline({
      startedAt: timing.startedAt,
      durationSec: timing.durationSec,
      globalExtensionSec: timing.globalExtensionSec,
      studentExtensionSec: studentId ? this.students.extensionSec(studentId) : 0,
    });
  }

  /** The latest deadline in the exam (the longest personal extension counts). */
  last(examId: string): number | null {
    const timing = this.exams.timing(examId);
    if (!timing || timing.startedAt === null) return null;
    return computeDeadline({
      startedAt: timing.startedAt,
      durationSec: timing.durationSec,
      globalExtensionSec: timing.globalExtensionSec,
      studentExtensionSec: this.students.maxExtensionSec(examId),
    });
  }

  graceMs(examId: string): number {
    return (this.exams.timing(examId)?.graceSec ?? 0) * 1000;
  }

  /** Working students whose deadline plus grace has passed: they are auto-submitted. */
  overdue(examId: string, now: number): string[] {
    const timing = this.exams.timing(examId);
    if (!timing || timing.startedAt === null) return [];
    const graceMs = timing.graceSec * 1000;
    return this.students
      .working(examId)
      .filter(
        (s) =>
          now >=
          computeDeadline({
            startedAt: timing.startedAt as number,
            durationSec: timing.durationSec,
            globalExtensionSec: timing.globalExtensionSec,
            studentExtensionSec: s.extensionSec,
          }) +
            graceMs,
      )
      .map((s) => s.id);
  }
}

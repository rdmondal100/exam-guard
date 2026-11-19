import type { ExamRepo, ExamTiming } from '../../db/repositories/exam.repo.js';
import type { ExamStudentRepo } from '../../db/repositories/examStudent.repo.js';
import { computeDeadline } from './deadline.js';

/**
 * Per-student deadlines and the time-up grace (docs/architecture.md §6). There is no stored
 * "ending" state: a student is ending between `deadline` and `deadline + grace`, and everything
 * here is recomputed from the stored start time, so a server restart changes nothing.
 *
 * A pause (M58) moves every deadline. Finished pauses always count; the pause still going on
 * counts only in `effective` (the server's own checks), so while paused the time-up never comes,
 * and `forStudent` (what apps show) stays fixed until the resume.
 */
export class StudentDeadlines {
  /**
   * After a server restart (M62): until when the exam stays open for the apps to reconnect and send
   * what they queued while it was down. Saves still count only if made by the deadline.
   */
  private readonly lateUntil = new Map<string, number>();

  constructor(
    private readonly exams: ExamRepo,
    private readonly students: ExamStudentRepo,
    private readonly now: () => number = Date.now,
  ) {}

  /** One student's deadline as shown (a personal extension counts); `null` studentId = none. */
  forStudent(examId: string, studentId: string | null): number | null {
    return this.compute(examId, studentId, false);
  }

  /** The deadline the server enforces: the pause still going on counts too. */
  effective(examId: string, studentId: string | null): number | null {
    return this.compute(examId, studentId, true);
  }

  /** The latest effective deadline in the exam (the longest personal extension counts). */
  last(examId: string): number | null {
    const timing = this.exams.timing(examId);
    if (!timing || timing.startedAt === null) return null;
    return this.deadline(timing, this.students.maxExtensionSec(examId), true);
  }

  graceMs(examId: string): number {
    return (this.exams.timing(examId)?.graceSec ?? 0) * 1000;
  }

  /** The server restarted: keep the exam open until `until` for the apps to reconnect (M62). */
  allowLateUntil(examId: string, until: number): void {
    this.lateUntil.set(examId, until);
  }

  /** When a deadline's grace is over: deadline + grace, or later right after a restart. */
  graceEnds(examId: string, deadline: number): number {
    return Math.max(deadline + this.graceMs(examId), this.lateUntil.get(examId) ?? 0);
  }

  /** When the exam was paused (M58), or `null` when it is not. */
  pausedAt(examId: string): number | null {
    return this.exams.timing(examId)?.pausedAt ?? null;
  }

  /** Working students whose effective deadline plus grace has passed: they are auto-submitted. */
  overdue(examId: string, now: number): string[] {
    const timing = this.exams.timing(examId);
    if (!timing || timing.startedAt === null) return [];
    const graceMs = timing.graceSec * 1000;
    const late = this.lateUntil.get(examId) ?? 0;
    return this.students
      .working(examId)
      .filter((s) => now >= Math.max(this.deadline(timing, s.extensionSec, true) + graceMs, late))
      .map((s) => s.id);
  }

  private compute(examId: string, studentId: string | null, ongoing: boolean): number | null {
    const timing = this.exams.timing(examId);
    if (!timing || timing.startedAt === null) return null;
    const extension = studentId ? this.students.extensionSec(studentId) : 0;
    return this.deadline(timing, extension, ongoing);
  }

  private deadline(timing: ExamTiming, studentExtensionSec: number, ongoing: boolean): number {
    const current =
      ongoing && timing.pausedAt !== null ? Math.max(0, this.now() - timing.pausedAt) : 0;
    return computeDeadline({
      startedAt: timing.startedAt ?? 0,
      durationSec: timing.durationSec,
      globalExtensionSec: timing.globalExtensionSec,
      studentExtensionSec,
      pausedMs: timing.pausedMs + current,
    });
  }
}

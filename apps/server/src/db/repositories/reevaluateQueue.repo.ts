import type { AnswerGradeStatus } from '@examguard/shared';
import type { Db } from '../connectDb.js';
import type { AnswerToGrade } from './answerGrade.repo.js';

/**
 * `answer_grades.queued_job_id` (M41, migration 0014): which re-evaluation job still has to grade
 * an answer. A queued answer keeps its current grade until the job grades it (`AnswerGradeRepo.set`
 * clears the mark), so a cancelled or failed re-evaluation changes nothing.
 */
export class ReevaluateQueueRepo {
  constructor(private readonly db: Db) {}

  /**
   * The answers of `ids` (every final answer of the question when `null`) whose status is in
   * `statuses`. The rows must exist (`AnswerGradeRepo.ensureRows`).
   */
  candidates(
    questionId: string,
    statuses: readonly AnswerGradeStatus[],
    ids: readonly string[] | null,
  ): string[] {
    if (statuses.length === 0) return [];
    const marks = statuses.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT exam_student_id FROM answer_grades WHERE question_id = ? AND status IN (${marks})
           AND (? = 0 OR exam_student_id IN (SELECT value FROM json_each(?)))
           ORDER BY exam_student_id`,
      )
      .all(questionId, ...statuses, ids ? 1 : 0, JSON.stringify(ids ?? [])) as {
      exam_student_id: string;
    }[];
    return rows.map((r) => r.exam_student_id);
  }

  /** Queues the answers for `jobId` (the job row must exist). */
  queue(jobId: string, questionId: string, ids: readonly string[]): void {
    this.db
      .prepare(
        `UPDATE answer_grades SET queued_job_id = ? WHERE question_id = ?
           AND exam_student_id IN (SELECT value FROM json_each(?))`,
      )
      .run(jobId, questionId, JSON.stringify(ids));
  }

  /** The answers the job still has to grade, with the anonymous id (resume picks these up). */
  answers(jobId: string): AnswerToGrade[] {
    const rows = this.db
      .prepare(
        `SELECT g.exam_student_id, s.anon_id, f.language, f.content FROM answer_grades g
           JOIN exam_students s ON s.id = g.exam_student_id
           JOIN final_answers f ON f.exam_student_id = g.exam_student_id
             AND f.question_id = g.question_id
           WHERE g.queued_job_id = ? ORDER BY g.exam_student_id`,
      )
      .all(jobId) as {
      exam_student_id: string;
      anon_id: string;
      language: string;
      content: string;
    }[];
    return rows.map((r) => ({
      examStudentId: r.exam_student_id,
      anonId: r.anon_id,
      language: r.language,
      content: r.content,
    }));
  }

  /** Drops the queue marks of the exam's jobs that will not run any more (cancelled, failed). */
  release(examId: string): void {
    this.db
      .prepare(
        `UPDATE answer_grades SET queued_job_id = NULL WHERE queued_job_id IN (
           SELECT id FROM grading_jobs WHERE exam_id = ? AND state NOT IN ('queued', 'running'))`,
      )
      .run(examId);
  }
}

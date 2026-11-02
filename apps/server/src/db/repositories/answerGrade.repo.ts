import type {
  AnswerGrade,
  AnswerGradeStatus,
  Confidence,
  QuestionGradeCounts,
  ReviewRow,
} from '@examguard/shared';
import type { Db } from '../connectDb.js';

/** One final answer to grade, with only what the AI may see about its author. */
export interface AnswerToGrade {
  examStudentId: string;
  anonId: string;
  language: string;
  content: string;
}

interface GradeRow {
  status: AnswerGradeStatus;
  total: number | null;
  confidence: Confidence | null;
  current_evaluation_id: number | null;
  updated_at: number;
}

const half = (n: number | null) => (n === null ? null : n / 2);

/** `answer_grades`: the current grade of each final answer (M38), pointing into `evaluations`. */
export class AnswerGradeRepo {
  constructor(private readonly db: Db) {}

  /**
   * Readies one question for a grading run: every final answer gets a `pending` row if it had
   * none, and the answers in `statuses` are set back to `pending`. Returns the ids to grade.
   */
  queueAnswers(questionId: string, statuses: readonly AnswerGradeStatus[], now: number): string[] {
    return this.db.transaction(() => {
      this.ensureRows(questionId, now);
      if (statuses.length === 0) return [];
      const marks = statuses.map(() => '?').join(', ');
      const rows = this.db
        .prepare(
          `SELECT exam_student_id FROM answer_grades WHERE question_id = ?
             AND status IN (${marks}) ORDER BY exam_student_id`,
        )
        .all(questionId, ...statuses) as { exam_student_id: string }[];
      this.db
        .prepare(
          `UPDATE answer_grades SET status = 'pending', current_evaluation_id = NULL, total = NULL,
             confidence = NULL, updated_at = ? WHERE question_id = ? AND status IN (${marks})
             AND status != 'pending'`,
        )
        .run(now, questionId, ...statuses);
      return rows.map((r) => r.exam_student_id);
    })();
  }

  /** Gives every final answer of the question a `pending` row if it has none yet. */
  ensureRows(questionId: string, now: number): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO answer_grades (exam_student_id, question_id, status, updated_at)
           SELECT exam_student_id, question_id, 'pending', ? FROM final_answers
           WHERE question_id = ?`,
      )
      .run(now, questionId);
  }

  /** The answers of `ids` that are still `pending`, with the anonymous id (resume picks these). */
  pendingAnswers(questionId: string, ids: readonly string[]): AnswerToGrade[] {
    if (ids.length === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT g.exam_student_id, s.anon_id, f.language, f.content FROM answer_grades g
           JOIN exam_students s ON s.id = g.exam_student_id
           JOIN final_answers f ON f.exam_student_id = g.exam_student_id
             AND f.question_id = g.question_id
           WHERE g.question_id = ? AND g.status = 'pending'
             AND g.exam_student_id IN (SELECT value FROM json_each(?))
           ORDER BY g.exam_student_id`,
      )
      .all(questionId, JSON.stringify(ids)) as {
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

  /** Points the grade at an evaluation. `total` in half-units. */
  set(
    examStudentId: string,
    questionId: string,
    grade: {
      status: AnswerGradeStatus;
      evaluationId: number | null;
      total: number | null;
      confidence: Confidence | null;
    },
    now: number,
  ): void {
    this.db
      .prepare(
        `UPDATE answer_grades SET status = ?, current_evaluation_id = ?, total = ?, confidence = ?,
           updated_at = ? WHERE exam_student_id = ? AND question_id = ?`,
      )
      .run(
        grade.status,
        grade.evaluationId,
        grade.total,
        grade.confidence,
        now,
        examStudentId,
        questionId,
      );
  }

  /** The API view (plain marks), or `undefined` when the answer has no grade row yet. */
  get(examStudentId: string, questionId: string): AnswerGrade | undefined {
    const row = this.db
      .prepare(
        `SELECT status, total, confidence, current_evaluation_id, updated_at FROM answer_grades
           WHERE exam_student_id = ? AND question_id = ?`,
      )
      .get(examStudentId, questionId) as GradeRow | undefined;
    return (
      row && {
        status: row.status,
        total: half(row.total),
        confidence: row.confidence,
        currentEvaluationId: row.current_evaluation_id,
        updatedAt: row.updated_at,
      }
    );
  }

  /** Per question of the exam, in question order, how its final answers stand. */
  counts(examId: string): QuestionGradeCounts[] {
    const rows = this.db
      .prepare(
        `SELECT q.id AS question_id, q.position,
           COUNT(f.exam_student_id) AS answers,
           SUM(g.status IS NULL OR g.status = 'pending') AS pending,
           SUM(g.status = 'ai_graded') AS ai_graded,
           SUM(g.status = 'verified') AS verified,
           SUM(g.status = 'modified') AS modified,
           SUM(g.status = 'needs_manual') AS needs_manual,
           SUM(g.status = 'ai_graded' AND g.confidence = 'low') AS low_confidence
         FROM questions q
         LEFT JOIN final_answers f ON f.question_id = q.id
         LEFT JOIN answer_grades g ON g.exam_student_id = f.exam_student_id
           AND g.question_id = f.question_id
         WHERE q.exam_id = ? GROUP BY q.id ORDER BY q.position`,
      )
      .all(examId) as Record<string, number | string | null>[];
    const n = (v: number | string | null | undefined) => Number(v ?? 0);
    return rows.map((r) => ({
      questionId: String(r.question_id),
      position: n(r.position),
      answers: n(r.answers),
      pending: r.answers ? n(r.pending) : 0,
      aiGraded: n(r.ai_graded),
      verified: n(r.verified),
      modified: n(r.modified),
      needsManual: n(r.needs_manual),
      lowConfidence: n(r.low_confidence),
    }));
  }

  /** The review table of one question (M39): every final answer, by student code. */
  reviewRows(questionId: string): ReviewRow[] {
    const rows = this.db
      .prepare(
        `SELECT f.exam_student_id, c.student_code, c.name, f.language, f.content, f.submitted_at,
           g.status, g.total, g.confidence, g.updated_at
         FROM final_answers f
         JOIN exam_students s ON s.id = f.exam_student_id
         JOIN class_students c ON c.id = s.class_student_id
         LEFT JOIN answer_grades g ON g.exam_student_id = f.exam_student_id
           AND g.question_id = f.question_id
         WHERE f.question_id = ?`,
      )
      .all(questionId) as {
      exam_student_id: string;
      student_code: string;
      name: string;
      language: string;
      content: string;
      submitted_at: number;
      status: AnswerGradeStatus | null;
      total: number | null;
      confidence: Confidence | null;
      updated_at: number | null;
    }[];
    return rows
      .map((r) => ({
        examStudentId: r.exam_student_id,
        studentCode: r.student_code,
        name: r.name,
        language: r.language,
        status: r.status ?? 'pending',
        total: half(r.total),
        confidence: r.confidence,
        empty: r.content.trim() === '',
        updatedAt: r.updated_at ?? r.submitted_at,
      }))
      .sort((a, b) => a.studentCode.localeCompare(b.studentCode, undefined, { numeric: true }));
  }
}

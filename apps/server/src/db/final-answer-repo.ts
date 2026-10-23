import type { Receipt, StudentState } from '@examguard/shared';
import type { Db } from './connection.js';

export interface NewFinalAnswer {
  questionId: string;
  language: string;
  content: string;
  versionId: number | null;
  sha256: string;
}

export interface FinalAnswer extends NewFinalAnswer {
  submittedAt: number;
}

/** `final_answers`, and the matching `exam_students` columns, written together and only once. */
export class FinalAnswerRepo {
  constructor(private readonly db: Db) {}

  /**
   * Stores the final answers and moves the student to `state` in one transaction. Only a student
   * who is still working (`active` or `locked`) can be finalized, so a second call changes nothing
   * and returns `false`.
   */
  commit(input: {
    examStudentId: string;
    state: Extract<StudentState, 'submitted' | 'ended_by_teacher'>;
    answers: readonly NewFinalAnswer[];
    hash: string;
    now: number;
  }): boolean {
    const mark = this.db.prepare(
      `UPDATE exam_students SET state = ?, submitted_at = ?, submission_hash = ?
         WHERE id = ? AND state IN ('active', 'locked')`,
    );
    const insert = this.db.prepare(
      `INSERT INTO final_answers (exam_student_id, question_id, language, content, version_id,
         sha256, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    return this.db.transaction(() => {
      if (mark.run(input.state, input.now, input.hash, input.examStudentId).changes === 0) {
        return false;
      }
      for (const a of input.answers) {
        insert.run(
          input.examStudentId,
          a.questionId,
          a.language,
          a.content,
          a.versionId,
          a.sha256,
          input.now,
        );
      }
      return true;
    })();
  }

  forStudent(examStudentId: string): FinalAnswer[] {
    const rows = this.db
      .prepare('SELECT * FROM final_answers WHERE exam_student_id = ? ORDER BY question_id')
      .all(examStudentId) as {
      question_id: string;
      language: string;
      content: string;
      version_id: number | null;
      sha256: string;
      submitted_at: number;
    }[];
    return rows.map((r) => ({
      questionId: r.question_id,
      language: r.language,
      content: r.content,
      versionId: r.version_id,
      sha256: r.sha256,
      submittedAt: r.submitted_at,
    }));
  }

  /** The stored receipt, or `null` while the student has not been finalized. */
  receiptFor(examStudentId: string): Receipt | null {
    const row = this.db
      .prepare('SELECT submitted_at, submission_hash FROM exam_students WHERE id = ?')
      .get(examStudentId) as
      { submitted_at: number | null; submission_hash: string | null } | undefined;
    if (!row || row.submitted_at === null || row.submission_hash === null) return null;
    return {
      hash: row.submission_hash,
      submittedAt: row.submitted_at,
      answers: this.forStudent(examStudentId).map((a) => ({
        questionId: a.questionId,
        language: a.language,
        sha256: a.sha256,
      })),
    };
  }
}

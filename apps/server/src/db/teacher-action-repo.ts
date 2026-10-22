import type { Db } from './connection.js';

export interface TeacherAction {
  examId: string;
  examStudentId: string | null;
  action: string;
  payload: Record<string, unknown>;
  ts: number;
}

/** `teacher_actions`: the audit log of what the teacher did. Insert only for now. */
export class TeacherActionRepo {
  constructor(private readonly db: Db) {}

  insert(action: TeacherAction): void {
    this.db
      .prepare(
        `INSERT INTO teacher_actions (exam_id, exam_student_id, action, payload_json, ts)
           VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        action.examId,
        action.examStudentId,
        action.action,
        JSON.stringify(action.payload),
        action.ts,
      );
  }

  /** Newest last. Used by tests and, later, the audit view. */
  list(examId: string): TeacherAction[] {
    const rows = this.db
      .prepare(
        `SELECT exam_id, exam_student_id, action, payload_json, ts FROM teacher_actions
           WHERE exam_id = ? ORDER BY id`,
      )
      .all(examId) as {
      exam_id: string;
      exam_student_id: string | null;
      action: string;
      payload_json: string;
      ts: number;
    }[];
    return rows.map((r) => ({
      examId: r.exam_id,
      examStudentId: r.exam_student_id,
      action: r.action,
      payload: JSON.parse(r.payload_json) as Record<string, unknown>,
      ts: r.ts,
    }));
  }
}

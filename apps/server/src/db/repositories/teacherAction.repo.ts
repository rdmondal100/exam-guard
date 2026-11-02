import type { AuditEntry } from '@examguard/shared';
import type { Db } from '../connectDb.js';

export interface TeacherAction {
  examId: string;
  examStudentId: string | null;
  action: string;
  payload: Record<string, unknown>;
  ts: number;
}

/** `teacher_actions`: the audit log of what the teacher did (and the server's own time-outs). */
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

  /** Oldest first. Used by tests. */
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
      payload: parsePayload(r.payload_json),
      ts: r.ts,
    }));
  }

  /** The audit view (M36): newest first, with the student's code and name. */
  audit(examId: string, limit: number): AuditEntry[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.action, a.exam_student_id, c.student_code, c.name, a.payload_json, a.ts
           FROM teacher_actions a
           LEFT JOIN exam_students s ON s.id = a.exam_student_id
           LEFT JOIN class_students c ON c.id = s.class_student_id
          WHERE a.exam_id = ?
          ORDER BY a.id DESC
          LIMIT ?`,
      )
      .all(examId, limit) as {
      id: number;
      action: string;
      exam_student_id: string | null;
      student_code: string | null;
      name: string | null;
      payload_json: string;
      ts: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      examStudentId: r.exam_student_id,
      studentCode: r.student_code,
      studentName: r.name,
      payload: parsePayload(r.payload_json),
      ts: r.ts,
    }));
  }
}

function parsePayload(json: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

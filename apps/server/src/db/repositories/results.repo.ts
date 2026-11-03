import type { StudentState, Severity } from '@examguard/shared';
import type { Db } from '../connectDb.js';

/** One student's line of the results export (M42). Marks in half-units. */
export interface ResultRow {
  examStudentId: string;
  studentCode: string;
  name: string;
  state: StudentState;
  outsideMs: number;
  /** Half-units by question id; a question without a grade is missing. */
  marks: Map<string, number>;
  events: Record<Severity, number>;
}

const noEvents = (): Record<Severity, number> => ({ low: 0, medium: 0, high: 0, critical: 0 });

/** Read-only queries for the results export: every student of the exam, absent ones too. */
export class ResultsRepo {
  constructor(private readonly db: Db) {}

  rows(examId: string): ResultRow[] {
    const students = this.db
      .prepare(
        `SELECT s.id, c.student_code, c.name, s.state, s.outside_ms_total FROM exam_students s
           JOIN class_students c ON c.id = s.class_student_id WHERE s.exam_id = ?`,
      )
      .all(examId) as {
      id: string;
      student_code: string;
      name: string;
      state: StudentState;
      outside_ms_total: number;
    }[];
    const byId = new Map<string, ResultRow>(
      students.map((s) => [
        s.id,
        {
          examStudentId: s.id,
          studentCode: s.student_code,
          name: s.name,
          state: s.state,
          outsideMs: s.outside_ms_total,
          marks: new Map(),
          events: noEvents(),
        },
      ]),
    );

    const grades = this.db
      .prepare(
        `SELECT g.exam_student_id, g.question_id, g.total FROM answer_grades g
           JOIN questions q ON q.id = g.question_id
           WHERE q.exam_id = ? AND g.total IS NOT NULL`,
      )
      .all(examId) as { exam_student_id: string; question_id: string; total: number }[];
    for (const g of grades) byId.get(g.exam_student_id)?.marks.set(g.question_id, g.total);

    const events = this.db
      .prepare(
        `SELECT exam_student_id, severity, COUNT(*) AS n FROM events
           WHERE exam_id = ? AND exam_student_id IS NOT NULL GROUP BY exam_student_id, severity`,
      )
      .all(examId) as { exam_student_id: string; severity: Severity; n: number }[];
    for (const ev of events) {
      const row = byId.get(ev.exam_student_id);
      if (row && ev.severity in row.events) row.events[ev.severity] = ev.n;
    }

    return [...byId.values()].sort((a, b) =>
      a.studentCode.localeCompare(b.studentCode, undefined, { numeric: true }),
    );
  }
}

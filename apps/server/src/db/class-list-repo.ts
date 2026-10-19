import type { ClassListSummary, ClassStudentRow } from '@examguard/shared';
import type { Db } from './connection.js';
import { newId } from './ids.js';

interface ListRow {
  id: string;
  name: string;
  created_at: number;
  student_count: number;
}

function toSummary(row: ListRow): ClassListSummary {
  return {
    id: row.id,
    name: row.name,
    studentCount: row.student_count,
    createdAt: row.created_at,
  };
}

export type DeleteResult = 'deleted' | 'not_found' | 'in_use';

/** `class_lists` and `class_students`. */
export class ClassListRepo {
  constructor(private readonly db: Db) {}

  list(): ClassListSummary[] {
    const rows = this.db
      .prepare(
        `SELECT l.id, l.name, l.created_at, COUNT(s.id) AS student_count
         FROM class_lists l LEFT JOIN class_students s ON s.class_list_id = l.id
         GROUP BY l.id ORDER BY l.created_at DESC, l.id DESC`,
      )
      .all() as ListRow[];
    return rows.map(toSummary);
  }

  /** Saves the list and all its students in one transaction. */
  create(name: string, students: ClassStudentRow[], now: number): ClassListSummary {
    const id = newId(now);
    const insertStudent = this.db.prepare(
      'INSERT INTO class_students (id, class_list_id, student_code, name) VALUES (?, ?, ?, ?)',
    );
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO class_lists (id, name, created_at) VALUES (?, ?, ?)')
        .run(id, name, now);
      for (const s of students) insertStudent.run(newId(now), id, s.studentCode, s.name);
    })();
    return { id, name, studentCount: students.length, createdAt: now };
  }

  /** `undefined` when the list does not exist. Ordered as they were imported. */
  students(listId: string): ClassStudentRow[] | undefined {
    if (this.db.prepare('SELECT 1 FROM class_lists WHERE id = ?').get(listId) === undefined) {
      return undefined;
    }
    const rows = this.db
      .prepare(
        'SELECT student_code, name FROM class_students WHERE class_list_id = ? ORDER BY rowid',
      )
      .all(listId) as { student_code: string; name: string }[];
    return rows.map((r) => ({ studentCode: r.student_code, name: r.name }));
  }

  /**
   * Deletes a list and its students. A list an exam points at (`exams.class_list_id` is
   * `ON DELETE RESTRICT`) is refused by SQLite and reported as `in_use`.
   */
  delete(listId: string): DeleteResult {
    try {
      const { changes } = this.db.prepare('DELETE FROM class_lists WHERE id = ?').run(listId);
      return changes > 0 ? 'deleted' : 'not_found';
    } catch (e) {
      if (e instanceof Error && 'code' in e && String(e.code).startsWith('SQLITE_CONSTRAINT')) {
        return 'in_use';
      }
      throw e;
    }
  }
}

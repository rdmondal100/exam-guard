import { randomBytes } from 'node:crypto';
import type { StudentState } from '@examguard/shared';
import type { Db } from './connection.js';
import { newId } from './ids.js';

export interface ClassStudent {
  id: string;
  studentCode: string;
  name: string;
}

export interface ExamStudent {
  id: string;
  examId: string;
  classStudentId: string;
  state: StudentState;
  tokenHash: string | null;
  deviceId: string | null;
}

interface Row {
  id: string;
  exam_id: string;
  class_student_id: string;
  state: StudentState;
  token_hash: string | null;
  device_id: string | null;
}

const toStudent = (row: Row): ExamStudent => ({
  id: row.id,
  examId: row.exam_id,
  classStudentId: row.class_student_id,
  state: row.state,
  tokenHash: row.token_hash,
  deviceId: row.device_id,
});

const SELECT =
  'SELECT id, exam_id, class_student_id, state, token_hash, device_id FROM exam_students';

/** `exam_students`: one row per student per exam, the session. */
export class ExamStudentRepo {
  constructor(private readonly db: Db) {}

  /** The student with this code on the exam's class list, if any. */
  findOnList(classListId: string, studentCode: string): ClassStudent | undefined {
    const row = this.db
      .prepare(
        'SELECT id, student_code, name FROM class_students WHERE class_list_id = ? AND student_code = ?',
      )
      .get(classListId, studentCode) as
      { id: string; student_code: string; name: string } | undefined;
    return row && { id: row.id, studentCode: row.student_code, name: row.name };
  }

  find(examId: string, classStudentId: string): ExamStudent | undefined {
    const row = this.db
      .prepare(`${SELECT} WHERE exam_id = ? AND class_student_id = ?`)
      .get(examId, classStudentId) as Row | undefined;
    return row && toStudent(row);
  }

  findByTokenHash(tokenHash: string): ExamStudent | undefined {
    const row = this.db.prepare(`${SELECT} WHERE token_hash = ?`).get(tokenHash) as Row | undefined;
    return row && toStudent(row);
  }

  create(examId: string, classStudentId: string, now: number): ExamStudent {
    const id = newId(now);
    this.db
      .prepare(
        `INSERT INTO exam_students (id, exam_id, class_student_id, anon_id, state)
         VALUES (?, ?, ?, ?, 'not_joined')`,
      )
      .run(id, examId, classStudentId, randomBytes(8).toString('hex'));
    const created = this.find(examId, classStudentId);
    if (!created) throw new Error('exam_students row vanished after insert');
    return created;
  }

  /** Binds the device (first join) and replaces the token hash. */
  bindSession(
    id: string,
    tokenHash: string,
    deviceId: string,
    pinnedFp: string,
    now: number,
  ): void {
    this.db
      .prepare(
        `UPDATE exam_students SET token_hash = ?, device_id = ?, pinned_fp = ?, last_seen_at = ?
           WHERE id = ?`,
      )
      .run(tokenHash, deviceId, pinnedFp, now, id);
  }

  /** `not_joined` → `lobby`. Any other state is left alone. Returns the state afterwards. */
  confirm(id: string, now: number): StudentState | undefined {
    this.db
      .prepare(
        "UPDATE exam_students SET state = 'lobby', joined_at = ? WHERE id = ? AND state = 'not_joined'",
      )
      .run(now, id);
    const row = this.db.prepare('SELECT state FROM exam_students WHERE id = ?').get(id) as
      { state: StudentState } | undefined;
    return row?.state;
  }
}

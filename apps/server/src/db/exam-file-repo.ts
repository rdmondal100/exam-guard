import type { ExamFile } from '@examguard/shared';
import type { Db } from './connection.js';

interface Row {
  id: string;
  name: string;
  size: number;
  sha256: string;
}

const toFile = (row: Row): ExamFile => ({
  id: row.id,
  name: row.name,
  size: row.size,
  sha256: row.sha256,
});

/** `exam_files` (migration 0008): the manifest of the files the teacher attached to an exam. */
export class ExamFileRepo {
  constructor(private readonly db: Db) {}

  list(examId: string): ExamFile[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, size, sha256 FROM exam_files WHERE exam_id = ? ORDER BY created_at, id',
      )
      .all(examId) as Row[];
    return rows.map(toFile);
  }

  get(examId: string, id: string): ExamFile | undefined {
    const row = this.db
      .prepare('SELECT id, name, size, sha256 FROM exam_files WHERE exam_id = ? AND id = ?')
      .get(examId, id) as Row | undefined;
    return row && toFile(row);
  }

  /** Case-insensitive, like the unique index. */
  findByName(examId: string, name: string): ExamFile | undefined {
    const row = this.db
      .prepare('SELECT id, name, size, sha256 FROM exam_files WHERE exam_id = ? AND name = ?')
      .get(examId, name) as Row | undefined;
    return row && toFile(row);
  }

  /** Bytes and number of files the exam has now. */
  totals(examId: string): { bytes: number; count: number } {
    const row = this.db
      .prepare(
        'SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS count FROM exam_files WHERE exam_id = ?',
      )
      .get(examId) as { bytes: number; count: number };
    return row;
  }

  insert(examId: string, file: ExamFile, now: number): void {
    this.db
      .prepare(
        'INSERT INTO exam_files (id, exam_id, name, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(file.id, examId, file.name, file.size, file.sha256, now);
  }

  /** In one step, so a replaced file never leaves two rows with one name. */
  replace(examId: string, oldId: string, file: ExamFile, now: number): void {
    this.db.transaction(() => {
      this.delete(examId, oldId);
      this.insert(examId, file, now);
    })();
  }

  delete(examId: string, id: string): boolean {
    return (
      this.db.prepare('DELETE FROM exam_files WHERE exam_id = ? AND id = ?').run(examId, id)
        .changes > 0
    );
  }
}

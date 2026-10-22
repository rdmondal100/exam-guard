import type { Db } from './connection.js';

/** Most transcript text stored per student; the rest is dropped after one marker. */
export const MAX_TRANSCRIPT_CHARS = 1024 * 1024;
export const TRUNCATED_MARKER = '\r\n[ExamGuard: transcript truncated, later output not kept]\r\n';
const TRUNCATED_KEY_PREFIX = 'truncated:';

export interface NewChunk {
  examStudentId: string;
  key: string;
  text: string;
  serverTs: number;
  clientTs: number;
}

/** `terminal_chunks`: each student's exam terminal output, in arrival order. */
export class TerminalLogRepo {
  constructor(private readonly db: Db) {}

  /**
   * Stores a chunk once per key. Over the cap, one truncation marker is stored instead and later
   * chunks are dropped. Returns what happened, so the caller can still ack a dropped chunk.
   */
  append(chunk: NewChunk): 'stored' | 'duplicate' | 'dropped' {
    return this.db.transaction((): 'stored' | 'duplicate' | 'dropped' => {
      const used = this.db
        .prepare(
          'SELECT COALESCE(SUM(LENGTH(text)), 0) AS n FROM terminal_chunks WHERE exam_student_id = ?',
        )
        .get(chunk.examStudentId) as { n: number };
      const insert = this.db.prepare(
        `INSERT INTO terminal_chunks (exam_student_id, chunk_key, server_ts, client_ts, text)
           VALUES (?, ?, ?, ?, ?) ON CONFLICT (chunk_key) DO NOTHING`,
      );
      if (used.n + chunk.text.length > MAX_TRANSCRIPT_CHARS) {
        insert.run(
          chunk.examStudentId,
          `${TRUNCATED_KEY_PREFIX}${chunk.examStudentId}`,
          chunk.serverTs,
          chunk.clientTs,
          TRUNCATED_MARKER,
        );
        return 'dropped';
      }
      const result = insert.run(
        chunk.examStudentId,
        `${chunk.examStudentId}:${chunk.key}`,
        chunk.serverTs,
        chunk.clientTs,
        chunk.text,
      );
      return result.changes > 0 ? 'stored' : 'duplicate';
    })();
  }

  transcript(examStudentId: string): { text: string; truncated: boolean } {
    const rows = this.db
      .prepare('SELECT chunk_key, text FROM terminal_chunks WHERE exam_student_id = ? ORDER BY id')
      .all(examStudentId) as { chunk_key: string; text: string }[];
    return {
      text: rows.map((r) => r.text).join(''),
      truncated: rows.some((r) => r.chunk_key.startsWith(TRUNCATED_KEY_PREFIX)),
    };
  }
}

import type { AnswerSnapshot, SaveReason, SavedAnswer } from '@examguard/shared';
import type { Db } from './connection.js';

export interface NewAnswerVersion {
  examStudentId: string;
  questionId: string;
  language: string;
  content: string;
  selected: boolean;
  reason: SaveReason;
  flags?: string;
  clientSeq: number;
  clientTs: number;
  serverTs: number;
}

export interface AnswerVersion {
  id: number;
  questionId: string;
  language: string;
  content: string;
  selected: boolean;
  reason: SaveReason;
  flags: string | null;
  clientSeq: number;
  clientTs: number | null;
  serverTs: number;
}

interface VersionRow {
  id: number;
  question_id: string;
  language: string;
  content: string;
  selected: number;
  reason: SaveReason;
  flags: string | null;
  client_seq: number;
  client_ts: number | null;
  server_ts: number;
}

/** `answer_versions`: one row per autosave, never updated. */
export class AnswerRepo {
  constructor(private readonly db: Db) {}

  /**
   * Stores the versions in one transaction. A `clientSeq` the student already has is skipped, so a
   * resend changes nothing. Returns how many rows were new.
   */
  insertMany(rows: readonly NewAnswerVersion[]): number {
    const insert = this.db.prepare(
      `INSERT INTO answer_versions (exam_student_id, question_id, language, content, selected,
         reason, flags, client_seq, client_ts, server_ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (exam_student_id, client_seq) DO NOTHING`,
    );
    return this.db.transaction(() => {
      let added = 0;
      for (const r of rows) {
        const result = insert.run(
          r.examStudentId,
          r.questionId,
          r.language,
          r.content,
          r.selected ? 1 : 0,
          r.reason,
          r.flags ?? null,
          r.clientSeq,
          r.clientTs,
          r.serverTs,
        );
        added += result.changes;
      }
      return added;
    })();
  }

  /**
   * The newest version of each buffer. `selected` marks, per question, the language of the newest
   * version that was saved as the selected one.
   */
  savedFor(examStudentId: string): SavedAnswer[] {
    const newest = this.db
      .prepare(
        `SELECT question_id, language, MAX(client_seq) AS client_seq FROM answer_versions
           WHERE exam_student_id = ? GROUP BY question_id, language`,
      )
      .all(examStudentId) as { question_id: string; language: string; client_seq: number }[];
    const selectedKey = new Set(
      this.selectedFor(examStudentId).map((c) => `${c.questionId}\u0000${c.language}`),
    );
    return newest.map((r) => ({
      questionId: r.question_id,
      language: r.language,
      clientSeq: r.client_seq,
      selected: selectedKey.has(`${r.question_id}\u0000${r.language}`),
    }));
  }

  /**
   * What a restarted student app needs: the content of the newest version of each buffer, and the
   * language each question was last saved as selected.
   */
  snapshot(examStudentId: string): AnswerSnapshot {
    const rows = this.db
      .prepare(
        `SELECT v.question_id, v.language, v.content, v.flags, v.client_seq FROM answer_versions v
           JOIN (SELECT question_id, language, MAX(client_seq) AS client_seq FROM answer_versions
                   WHERE exam_student_id = ? GROUP BY question_id, language) n
             ON v.question_id = n.question_id AND v.language = n.language
            AND v.client_seq = n.client_seq
          WHERE v.exam_student_id = ?
          ORDER BY v.client_seq`,
      )
      .all(examStudentId, examStudentId) as {
      question_id: string;
      language: string;
      content: string;
      flags: string | null;
      client_seq: number;
    }[];
    return {
      buffers: rows.map((r) => ({
        questionId: r.question_id,
        language: r.language,
        content: r.content,
        flags: r.flags,
        clientSeq: r.client_seq,
      })),
      selected: this.selectedFor(examStudentId),
    };
  }

  /** Per question, the language and sequence of the newest version saved as selected. */
  private selectedFor(
    examStudentId: string,
  ): { questionId: string; language: string; clientSeq: number }[] {
    const rows = this.db
      .prepare(
        `SELECT question_id, language, MAX(client_seq) AS client_seq FROM answer_versions
           WHERE exam_student_id = ? AND selected = 1 GROUP BY question_id`,
      )
      .all(examStudentId) as { question_id: string; language: string; client_seq: number }[];
    return rows.map((r) => ({
      questionId: r.question_id,
      language: r.language,
      clientSeq: r.client_seq,
    }));
  }

  /** The newest version of one buffer. */
  latest(examStudentId: string, questionId: string, language: string): AnswerVersion | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM answer_versions
           WHERE exam_student_id = ? AND question_id = ? AND language = ?
           ORDER BY client_seq DESC LIMIT 1`,
      )
      .get(examStudentId, questionId, language) as VersionRow | undefined;
    return row && toVersion(row);
  }

  /** Every version of one student, oldest first. */
  list(examStudentId: string): AnswerVersion[] {
    const rows = this.db
      .prepare('SELECT * FROM answer_versions WHERE exam_student_id = ? ORDER BY client_seq')
      .all(examStudentId) as VersionRow[];
    return rows.map(toVersion);
  }
}

function toVersion(r: VersionRow): AnswerVersion {
  return {
    id: r.id,
    questionId: r.question_id,
    language: r.language,
    content: r.content,
    selected: r.selected === 1,
    reason: r.reason,
    flags: r.flags,
    clientSeq: r.client_seq,
    clientTs: r.client_ts,
    serverTs: r.server_ts,
  };
}

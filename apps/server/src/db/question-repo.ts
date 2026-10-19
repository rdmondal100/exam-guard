import {
  type Question,
  type QuestionBody,
  type QuestionLanguage,
  type QuestionType,
} from '@examguard/shared';
import type { Db } from './connection.js';
import { newId } from './ids.js';

interface QuestionRow {
  id: string;
  exam_id: string;
  position: number;
  type: QuestionType;
  body: string;
  marks: number;
  allowed_languages_json: string | null;
  student_note: string;
  sample_answer: string;
  sample_language: string;
  ai_notes: string;
}

interface CriterionRow {
  question_id: string;
  name: string;
  max_marks: number;
}

const toHalf = (marks: number) => Math.round(marks * 2);
const fromHalf = (half: number) => half / 2;

/** `questions` and `marking_criteria`. Marks are integer half-units in the DB, marks in the API. */
export class QuestionRepo {
  constructor(private readonly db: Db) {}

  list(examId: string): Question[] {
    const rows = this.db
      .prepare('SELECT * FROM questions WHERE exam_id = ? ORDER BY position')
      .all(examId) as QuestionRow[];
    const criteria = this.db
      .prepare(
        `SELECT c.question_id, c.name, c.max_marks FROM marking_criteria c
           JOIN questions q ON q.id = c.question_id WHERE q.exam_id = ? ORDER BY c.position`,
      )
      .all(examId) as CriterionRow[];
    return rows.map((row) => toQuestion(row, criteria));
  }

  get(id: string): Question | undefined {
    const row = this.db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as
      QuestionRow | undefined;
    if (!row) return undefined;
    const criteria = this.criteriaOf(id);
    return toQuestion(row, criteria);
  }

  /** Appends the question after the last one. */
  create(examId: string, body: QuestionBody, now: number): Question {
    const id = newId(now);
    this.db.transaction(() => {
      const last = this.db
        .prepare('SELECT COALESCE(MAX(position), 0) AS p FROM questions WHERE exam_id = ?')
        .get(examId) as { p: number };
      this.insertQuestion(id, examId, last.p + 1, body, now);
    })();
    return this.requireQuestion(id);
  }

  /** Replaces every editable field and the whole criteria list. `undefined` if missing. */
  update(id: string, body: QuestionBody, now: number): Question | undefined {
    if (!this.get(id)) return undefined;
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE questions SET type = ?, body = ?, marks = ?, allowed_languages_json = ?,
             student_note = ?, sample_answer = ?, sample_language = ?, ai_notes = ? WHERE id = ?`,
        )
        .run(
          body.type,
          body.body,
          sumHalf(body),
          languagesJson(body),
          body.studentNote,
          body.sampleAnswer,
          body.sampleLanguage,
          body.aiNotes,
          id,
        );
      this.db.prepare('DELETE FROM marking_criteria WHERE question_id = ?').run(id);
      this.insertCriteria(id, body, now);
    })();
    return this.requireQuestion(id);
  }

  /** Deletes the question and closes the gap in the positions. */
  delete(id: string): boolean {
    const row = this.db.prepare('SELECT exam_id FROM questions WHERE id = ?').get(id) as
      { exam_id: string } | undefined;
    if (!row) return false;
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM questions WHERE id = ?').run(id);
      this.writeOrder(
        row.exam_id,
        this.list(row.exam_id).map((q) => q.id),
      );
    })();
    return true;
  }

  /** `ids` must be exactly the exam's question ids; returns false when they are not. */
  reorder(examId: string, ids: string[]): boolean {
    const current = this.list(examId).map((q) => q.id);
    if (ids.length !== current.length || !current.every((id) => ids.includes(id))) return false;
    if (new Set(ids).size !== ids.length) return false;
    this.db.transaction(() => this.writeOrder(examId, ids))();
    return true;
  }

  /** Copies every question and its criteria into another exam, in order (used by duplicate). */
  copyAll(fromExamId: string, toExamId: string, now: number): void {
    this.db.transaction(() => {
      for (const q of this.list(fromExamId)) {
        const copy: QuestionBody = {
          type: q.type,
          body: q.body,
          allowedLanguages: q.allowedLanguages,
          studentNote: q.studentNote,
          sampleAnswer: q.sampleAnswer,
          sampleLanguage: q.sampleLanguage,
          aiNotes: q.aiNotes,
          criteria: q.criteria,
        };
        this.insertQuestion(newId(now), toExamId, q.position, copy, now);
      }
    })();
  }

  /** Two steps (shift out of range, then assign) so UNIQUE(exam_id, position) never collides. */
  private writeOrder(examId: string, ids: string[]): void {
    this.db
      .prepare('UPDATE questions SET position = position + 100000 WHERE exam_id = ?')
      .run(examId);
    const set = this.db.prepare('UPDATE questions SET position = ? WHERE id = ?');
    ids.forEach((id, index) => set.run(index + 1, id));
  }

  private insertQuestion(
    id: string,
    examId: string,
    position: number,
    body: QuestionBody,
    now: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO questions (id, exam_id, position, type, body, marks, allowed_languages_json,
           student_note, sample_answer, sample_language, ai_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        examId,
        position,
        body.type,
        body.body,
        sumHalf(body),
        languagesJson(body),
        body.studentNote,
        body.sampleAnswer,
        body.sampleLanguage,
        body.aiNotes,
      );
    this.insertCriteria(id, body, now);
  }

  private insertCriteria(questionId: string, body: QuestionBody, now: number): void {
    const insert = this.db.prepare(
      'INSERT INTO marking_criteria (id, question_id, position, name, max_marks) VALUES (?, ?, ?, ?, ?)',
    );
    body.criteria.forEach((c, index) =>
      insert.run(newId(now), questionId, index + 1, c.name, toHalf(c.maxMarks)),
    );
  }

  private criteriaOf(questionId: string): CriterionRow[] {
    return this.db
      .prepare(
        'SELECT question_id, name, max_marks FROM marking_criteria WHERE question_id = ? ORDER BY position',
      )
      .all(questionId) as CriterionRow[];
  }

  private requireQuestion(id: string): Question {
    const q = this.get(id);
    if (!q) throw new Error(`Question ${id} vanished after a write`);
    return q;
  }
}

function sumHalf(body: QuestionBody): number {
  return body.criteria.reduce((sum, c) => sum + toHalf(c.maxMarks), 0);
}

function languagesJson(body: QuestionBody): string | null {
  return body.type === 'code' ? JSON.stringify(body.allowedLanguages) : null;
}

function toQuestion(row: QuestionRow, criteria: CriterionRow[]): Question {
  return {
    id: row.id,
    examId: row.exam_id,
    position: row.position,
    type: row.type,
    body: row.body,
    marks: fromHalf(row.marks),
    allowedLanguages:
      row.allowed_languages_json === null
        ? []
        : (JSON.parse(row.allowed_languages_json) as QuestionLanguage[]),
    studentNote: row.student_note,
    sampleAnswer: row.sample_answer,
    sampleLanguage: row.sample_language,
    aiNotes: row.ai_notes,
    criteria: criteria
      .filter((c) => c.question_id === row.id)
      .map((c) => ({ name: c.name, maxMarks: fromHalf(c.max_marks) })),
  };
}

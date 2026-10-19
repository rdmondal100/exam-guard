import {
  DEFAULT_MONITORING,
  MonitoringSettingsSchema,
  type ExamCreateBody,
  type ExamState,
  type ExamSummary,
  type ExamUpdateBody,
} from '@examguard/shared';
import type { Db } from './connection.js';
import { newId } from './ids.js';
import { QuestionRepo } from './question-repo.js';

interface ExamRow {
  id: string;
  title: string;
  state: ExamState;
  duration_sec: number;
  class_list_id: string | null;
  class_list_name: string | null;
  monitoring_json: string;
  created_at: number;
  updated_at: number;
}

const SELECT = `SELECT e.id, e.title, e.state, e.duration_sec, e.class_list_id,
    l.name AS class_list_name, e.monitoring_json, e.created_at, e.updated_at
  FROM exams e LEFT JOIN class_lists l ON l.id = e.class_list_id`;

function toSummary(row: ExamRow): ExamSummary {
  return {
    id: row.id,
    title: row.title,
    state: row.state,
    durationMin: Math.round(row.duration_sec / 60),
    classListId: row.class_list_id,
    classListName: row.class_list_name,
    monitoring: MonitoringSettingsSchema.parse(JSON.parse(row.monitoring_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** `exams`. State changes beyond create/duplicate arrive with the milestones that own them. */
export class ExamRepo {
  constructor(private readonly db: Db) {}

  list(): ExamSummary[] {
    const rows = this.db
      .prepare(`${SELECT} ORDER BY e.created_at DESC, e.id DESC`)
      .all() as ExamRow[];
    return rows.map(toSummary);
  }

  get(id: string): ExamSummary | undefined {
    const row = this.db.prepare(`${SELECT} WHERE e.id = ?`).get(id) as ExamRow | undefined;
    return row && toSummary(row);
  }

  classListExists(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM class_lists WHERE id = ?').get(id) !== undefined;
  }

  create(body: ExamCreateBody, now: number): ExamSummary {
    const id = newId(now);
    this.insert(
      id,
      body.title,
      body.durationMin * 60,
      body.classListId ?? null,
      body.monitoring ?? DEFAULT_MONITORING,
      now,
    );
    return this.requireExam(id);
  }

  /** Partial update. `undefined` when the exam does not exist. */
  update(id: string, patch: ExamUpdateBody, now: number): ExamSummary | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    this.db
      .prepare(
        `UPDATE exams SET title = ?, duration_sec = ?, class_list_id = ?, monitoring_json = ?,
           updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.title ?? current.title,
        (patch.durationMin ?? current.durationMin) * 60,
        patch.classListId === undefined ? current.classListId : patch.classListId,
        JSON.stringify(patch.monitoring ?? current.monitoring),
        now,
        id,
      );
    return this.requireExam(id);
  }

  /**
   * A new draft with the same title, duration, class list and monitoring settings, and no
   * runtime data (pin, timestamps, extension). Questions and criteria are copied too.
   */
  duplicate(id: string, now: number): ExamSummary | undefined {
    const source = this.get(id);
    if (!source) return undefined;
    const copyId = newId(now);
    this.db.transaction(() => {
      this.insert(
        copyId,
        `${source.title} (copy)`,
        source.durationMin * 60,
        source.classListId,
        source.monitoring,
        now,
      );
      new QuestionRepo(this.db).copyAll(id, copyId, now);
    })();
    return this.requireExam(copyId);
  }

  setState(id: string, state: ExamState, now: number): ExamSummary | undefined {
    this.db.prepare('UPDATE exams SET state = ?, updated_at = ? WHERE id = ?').run(state, now, id);
    return this.get(id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM exams WHERE id = ?').run(id).changes > 0;
  }

  private insert(
    id: string,
    title: string,
    durationSec: number,
    classListId: string | null,
    monitoring: ExamSummary['monitoring'],
    now: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO exams (id, title, state, duration_sec, class_list_id, monitoring_json,
           created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`,
      )
      .run(id, title, durationSec, classListId, JSON.stringify(monitoring), now, now);
  }

  private requireExam(id: string): ExamSummary {
    const exam = this.get(id);
    if (!exam) throw new Error(`Exam ${id} vanished after a write`);
    return exam;
  }
}

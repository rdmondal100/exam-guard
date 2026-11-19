import {
  DEFAULT_MONITORING,
  DEFAULT_RUN_LIMITS,
  MonitoringSettingsSchema,
  RunLimitsSchema,
  type ExamCreateBody,
  type MonitoringSettings,
  type RunLimits,
  type ExamState,
  type ExamSummary,
  type ExamUpdateBody,
} from '@examguard/shared';
import type { Db } from '../connectDb.js';
import { newId } from '../../utils/ids.js';
import { QuestionRepo } from './question.repo.js';

interface ExamRow {
  id: string;
  title: string;
  state: ExamState;
  duration_sec: number;
  class_list_id: string | null;
  class_list_name: string | null;
  monitoring_json: string;
  files_enabled: number;
  practice: number;
  created_at: number;
  updated_at: number;
}

export interface ExamTiming {
  startedAt: number | null;
  durationSec: number;
  globalExtensionSec: number;
  /** How long after a deadline queued saves are still accepted (`monitoring.graceSec`). */
  graceSec: number;
  /** When the current pause began (M58), or `null` when the exam is not paused. */
  pausedAt: number | null;
  /** All finished pauses together, ms: every deadline moves by it. */
  pausedMs: number;
}

const SELECT = `SELECT e.id, e.title, e.state, e.duration_sec, e.class_list_id,
    l.name AS class_list_name, e.monitoring_json, e.files_enabled, e.practice,
    e.created_at, e.updated_at
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
    filesEnabled: row.files_enabled === 1,
    practice: row.practice === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** `exams`. State changes beyond create/duplicate arrive with the milestones that own them. */
export class ExamRepo {
  constructor(private readonly db: Db) {}

  /** Runs `fn` in one transaction (writes that span repositories, e.g. starting grading). */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

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

  /** `defaultMonitoring` is the teacher's default from Settings (M43) when the body has none. */
  create(
    body: ExamCreateBody,
    now: number,
    defaultMonitoring: MonitoringSettings = DEFAULT_MONITORING,
  ): ExamSummary {
    const id = newId(now);
    this.insert(
      id,
      body.title,
      body.durationMin * 60,
      body.classListId ?? null,
      body.monitoring ?? defaultMonitoring,
      body.filesEnabled ?? true,
      body.practice ?? false,
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
           files_enabled = ?, practice = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.title ?? current.title,
        (patch.durationMin ?? current.durationMin) * 60,
        patch.classListId === undefined ? current.classListId : patch.classListId,
        JSON.stringify(patch.monitoring ?? current.monitoring),
        (patch.filesEnabled ?? current.filesEnabled) ? 1 : 0,
        (patch.practice ?? current.practice) ? 1 : 0,
        now,
        id,
      );
    return this.requireExam(id);
  }

  /**
   * A new draft with the same title, duration, class list, monitoring and Files settings, and no
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
        source.filesEnabled,
        source.practice,
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

  /** in_review → finalized (M42): the marks are locked. Returns false when it was not in review. */
  finalize(id: string, now: number): boolean {
    return (
      this.db
        .prepare(
          `UPDATE exams SET state = 'finalized', finalized_at = ?, updated_at = ?
             WHERE id = ? AND state = 'in_review'`,
        )
        .run(now, now, id).changes === 1
    );
  }

  /**
   * ready → hosting: stores the PIN, the hosting start time and the run limits from Settings
   * (M43; `null` keeps the defaults).
   */
  startHosting(
    id: string,
    pin: string,
    now: number,
    runLimits: RunLimits | null = null,
  ): ExamSummary | undefined {
    // Only from `ready` (M60): the exam may have been edited back to draft or deleted while the
    // listener was opening.
    const changed = this.db
      .prepare(
        `UPDATE exams SET state = 'hosting', pin = ?, hosting_started_at = ?, updated_at = ?,
           run_limits_json = ? WHERE id = ? AND state = 'ready'`,
      )
      .run(pin, now, now, runLimits && JSON.stringify(runLimits), id).changes;
    return changed > 0 ? this.get(id) : undefined;
  }

  /** The exam's run limits as fixed at hosting start (M43), else the defaults. */
  runLimits(id: string): RunLimits {
    const row = this.db.prepare('SELECT run_limits_json FROM exams WHERE id = ?').get(id) as
      { run_limits_json: string | null } | undefined;
    if (!row?.run_limits_json) return DEFAULT_RUN_LIMITS;
    const parsed = RunLimitsSchema.safeParse(JSON.parse(row.run_limits_json));
    return parsed.success ? parsed.data : DEFAULT_RUN_LIMITS;
  }

  /** hosting → ready: clears the PIN and the hosting start time. */
  stopHosting(id: string, now: number): ExamSummary | undefined {
    this.db
      .prepare(
        `UPDATE exams SET state = 'ready', pin = NULL, hosting_started_at = NULL, updated_at = ?
           WHERE id = ?`,
      )
      .run(now, id);
    return this.get(id);
  }

  /** Adds extra time for everyone (M36), seconds. */
  addGlobalExtension(id: string, seconds: number, now: number): void {
    this.db
      .prepare(
        'UPDATE exams SET global_extension_sec = global_extension_sec + ?, updated_at = ? WHERE id = ?',
      )
      .run(Math.max(0, Math.round(seconds)), now, id);
  }

  /** hosting → running: the PIN stays so late joiners and a restart can still use it. */
  startRunning(id: string, now: number): ExamSummary | undefined {
    this.db
      .prepare("UPDATE exams SET state = 'running', started_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, id);
    return this.get(id);
  }

  /**
   * running → ended. The PIN is cleared: nobody can join an ended exam. A pause still going on ends
   * too, and its length counts in `paused_ms` (M60).
   */
  endRunning(id: string, now: number): ExamSummary | undefined {
    this.db
      .prepare(
        `UPDATE exams SET state = 'ended', pin = NULL, ended_at = ?,
           paused_ms = paused_ms + CASE WHEN paused_at IS NULL THEN 0 ELSE MAX(0, ? - paused_at) END,
           paused_at = NULL, updated_at = ?
           WHERE id = ?`,
      )
      .run(now, now, now, id);
    return this.get(id);
  }

  /** Pauses a running exam (M58). Returns whether it was running and not yet paused. */
  pause(id: string, now: number): boolean {
    const sql = `UPDATE exams SET paused_at = ?, updated_at = ?
      WHERE id = ? AND state = 'running' AND paused_at IS NULL`;
    return this.db.prepare(sql).run(now, now, id).changes > 0;
  }

  /** Ends the pause; its length goes into `paused_ms`. Returns whether the exam was paused. */
  resume(id: string, now: number): boolean {
    const sql = `UPDATE exams SET paused_ms = paused_ms + MAX(0, ? - paused_at), paused_at = NULL,
      updated_at = ? WHERE id = ? AND state = 'running' AND paused_at IS NOT NULL`;
    return this.db.prepare(sql).run(now, now, id).changes > 0;
  }

  /** The exam currently in `hosting`, with its PIN. At most one exists. */
  hostedExam(): { exam: ExamSummary; pin: string } | undefined {
    return this.exam('hosting');
  }

  /** The exam currently in `running`, with its PIN. */
  runningExam(): { exam: ExamSummary; pin: string } | undefined {
    return this.exam('running');
  }

  /** Start time, extension and time-up grace of an exam, for the deadline. */
  timing(id: string): ExamTiming | undefined {
    const row = this.db
      .prepare(
        `SELECT started_at, duration_sec, global_extension_sec, monitoring_json, paused_at, paused_ms
           FROM exams WHERE id = ?`,
      )
      .get(id) as
      | {
          started_at: number | null;
          duration_sec: number;
          global_extension_sec: number;
          monitoring_json: string;
          paused_at: number | null;
          paused_ms: number;
        }
      | undefined;
    return (
      row && {
        startedAt: row.started_at,
        durationSec: row.duration_sec,
        globalExtensionSec: row.global_extension_sec,
        graceSec: MonitoringSettingsSchema.parse(JSON.parse(row.monitoring_json)).graceSec,
        pausedAt: row.paused_at,
        pausedMs: row.paused_ms,
      }
    );
  }

  private exam(state: 'hosting' | 'running'): { exam: ExamSummary; pin: string } | undefined {
    const row = this.db.prepare('SELECT id, pin FROM exams WHERE state = ?').get(state) as
      { id: string; pin: string | null } | undefined;
    const exam = row && this.get(row.id);
    return row?.pin && exam ? { exam, pin: row.pin } : undefined;
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
    filesEnabled: boolean,
    practice: boolean,
    now: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO exams (id, title, state, duration_sec, class_list_id, monitoring_json,
           files_enabled, practice, created_at, updated_at)
         VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        title,
        durationSec,
        classListId,
        JSON.stringify(monitoring),
        filesEnabled ? 1 : 0,
        practice ? 1 : 0,
        now,
        now,
      );
  }

  private requireExam(id: string): ExamSummary {
    const exam = this.get(id);
    if (!exam) throw new Error(`Exam ${id} vanished after a write`);
    return exam;
  }
}

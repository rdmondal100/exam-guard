import type { EventRow as EventDto, Severity, TerminalLogEvent } from '@examguard/shared';
import type { Db } from './connection.js';

export interface NewEvent {
  examId: string;
  examStudentId: string | null;
  type: string;
  severity: Severity;
  source: 'agent' | 'app' | 'server';
  details: Record<string, unknown>;
  serverTs: number;
  clientTs?: number;
  dedupeKey?: string;
}

/** What the teacher's list can be narrowed to. */
export interface EventFilter {
  examStudentId?: string;
  severity?: Severity;
  source?: NewEvent['source'];
  /** Only events with an id above this one (the list's last seen id). */
  after?: number;
  limit: number;
}

/** `events`. The classifier and the general queries arrive with monitoring. */
export class EventRepo {
  constructor(private readonly db: Db) {}

  /** Returns `false` when an event with the same dedupe key is already stored. */
  insert(event: NewEvent): boolean {
    return this.insertReturningId(event) !== null;
  }

  /** The new event's id, or `null` when an event with the same dedupe key is already stored. */
  insertReturningId(event: NewEvent): number | null {
    const result = this.db
      .prepare(
        `INSERT INTO events (exam_id, exam_student_id, type, severity, server_ts, client_ts,
           details_json, source, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (dedupe_key) DO NOTHING`,
      )
      .run(
        event.examId,
        event.examStudentId,
        event.type,
        event.severity,
        event.serverTs,
        event.clientTs ?? null,
        JSON.stringify(event.details),
        event.source,
        event.dedupeKey ?? null,
      );
    return result.changes > 0 ? Number(result.lastInsertRowid) : null;
  }

  /** Points an event at its screenshot file (relative to the data folder). */
  setScreenshot(id: number, path: string): void {
    this.db.prepare('UPDATE events SET screenshot_path = ? WHERE id = ?').run(path, id);
  }

  /** The stored screenshot path of an event, with the exam it belongs to. */
  screenshotOf(id: number): { examId: string; path: string } | undefined {
    const row = this.db
      .prepare('SELECT exam_id, screenshot_path FROM events WHERE id = ?')
      .get(id) as { exam_id: string; screenshot_path: string | null } | undefined;
    return row?.screenshot_path ? { examId: row.exam_id, path: row.screenshot_path } : undefined;
  }

  /** An exam's events for the teacher, newest first, with the student's code and name. */
  list(examId: string, filter: EventFilter): EventDto[] {
    const where = ['e.exam_id = ?'];
    const args: (string | number)[] = [examId];
    if (filter.examStudentId) {
      where.push('e.exam_student_id = ?');
      args.push(filter.examStudentId);
    }
    if (filter.severity) {
      where.push('e.severity = ?');
      args.push(filter.severity);
    }
    if (filter.source) {
      where.push('e.source = ?');
      args.push(filter.source);
    }
    if (filter.after !== undefined) {
      where.push('e.id > ?');
      args.push(filter.after);
    }
    const rows = this.db
      .prepare(
        `SELECT e.id, e.exam_student_id, c.student_code, c.name, e.type, e.severity, e.server_ts,
           e.client_ts, e.details_json, e.screenshot_path
         FROM events e
         LEFT JOIN exam_students s ON s.id = e.exam_student_id
         LEFT JOIN class_students c ON c.id = s.class_student_id
         WHERE ${where.join(' AND ')} ORDER BY e.id DESC LIMIT ?`,
      )
      .all(...args, filter.limit) as ListRow[];
    return rows.map(toDto);
  }

  /** The newest event of one student among the given types, or `undefined`. */
  lastOfTypes(examStudentId: string, types: readonly string[]): TerminalLogEvent | undefined {
    if (types.length === 0) return undefined;
    const row = this.db
      .prepare(
        `SELECT id, type, server_ts, client_ts, details_json FROM events
           WHERE exam_student_id = ? AND type IN (${types.map(() => '?').join(', ')})
           ORDER BY server_ts DESC, id DESC LIMIT 1`,
      )
      .get(examStudentId, ...types) as EventRow | undefined;
    return row && toLogEvent(row);
  }

  /** One student's events of the given types, oldest first. */
  listForStudent(examStudentId: string, types: readonly string[]): TerminalLogEvent[] {
    if (types.length === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT id, type, server_ts, client_ts, details_json FROM events
           WHERE exam_student_id = ? AND type IN (${types.map(() => '?').join(', ')})
           ORDER BY server_ts, id`,
      )
      .all(examStudentId, ...types) as EventRow[];
    return rows.map(toLogEvent);
  }
}

interface EventRow {
  id: number;
  type: string;
  server_ts: number;
  client_ts: number | null;
  details_json: string;
}

interface ListRow extends EventRow {
  exam_student_id: string | null;
  student_code: string | null;
  name: string | null;
  severity: Severity;
  screenshot_path: string | null;
}

const toDto = (r: ListRow): EventDto => ({
  id: r.id,
  examStudentId: r.exam_student_id,
  studentCode: r.student_code,
  studentName: r.name,
  type: r.type,
  severity: r.severity,
  serverTs: r.server_ts,
  clientTs: r.client_ts,
  details: JSON.parse(r.details_json) as Record<string, unknown>,
  hasScreenshot: r.screenshot_path !== null,
});

const toLogEvent = (r: EventRow): TerminalLogEvent => ({
  id: r.id,
  type: r.type,
  serverTs: r.server_ts,
  clientTs: r.client_ts,
  details: JSON.parse(r.details_json) as Record<string, unknown>,
});

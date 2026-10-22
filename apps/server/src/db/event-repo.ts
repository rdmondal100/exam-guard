import type { TerminalLogEvent } from '@examguard/shared';
import type { Db } from './connection.js';

export interface NewEvent {
  examId: string;
  examStudentId: string | null;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: 'agent' | 'app' | 'server';
  details: Record<string, unknown>;
  serverTs: number;
  clientTs?: number;
  dedupeKey?: string;
}

/** `events`. The classifier and the general queries arrive with monitoring. */
export class EventRepo {
  constructor(private readonly db: Db) {}

  /** Returns `false` when an event with the same dedupe key is already stored. */
  insert(event: NewEvent): boolean {
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
    return result.changes > 0;
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
      .all(examStudentId, ...types) as {
      id: number;
      type: string;
      server_ts: number;
      client_ts: number | null;
      details_json: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      serverTs: r.server_ts,
      clientTs: r.client_ts,
      details: JSON.parse(r.details_json) as Record<string, unknown>,
    }));
  }
}

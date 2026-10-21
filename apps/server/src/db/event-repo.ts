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

/** `events`. Only the insert exists so far; the classifier and queries arrive with monitoring. */
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
}

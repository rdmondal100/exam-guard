import { randomBytes } from 'node:crypto';
import type { HostingCounts, RosterEntry, StudentState } from '@examguard/shared';
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

  /** `lobby` → `active` for one student. Returns whether the row changed. */
  activate(id: string, now: number): boolean {
    return (
      this.db
        .prepare(
          "UPDATE exam_students SET state = 'active', started_at = ? WHERE id = ? AND state = 'lobby'",
        )
        .run(now, id).changes > 0
    );
  }

  /** Everyone waiting in the lobby becomes `active`. Returns their ids. */
  activateAllInLobby(examId: string, now: number): string[] {
    const ids = (
      this.db
        .prepare("SELECT id FROM exam_students WHERE exam_id = ? AND state = 'lobby'")
        .all(examId) as { id: string }[]
    ).map((r) => r.id);
    for (const id of ids) this.activate(id, now);
    return ids;
  }

  /** Students still working (`active` or `locked`) with their personal extra time, seconds. */
  working(examId: string): { id: string; extensionSec: number }[] {
    const rows = this.db
      .prepare(
        "SELECT id, extension_sec FROM exam_students WHERE exam_id = ? AND state IN ('active', 'locked')",
      )
      .all(examId) as { id: string; extension_sec: number }[];
    return rows.map((r) => ({ id: r.id, extensionSec: r.extension_sec }));
  }

  /** The longest personal extension in the exam, seconds (the exam's real end uses it). */
  maxExtensionSec(examId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(extension_sec), 0) AS m FROM exam_students WHERE exam_id = ?')
      .get(examId) as { m: number };
    return row.m;
  }

  /** Personal extra time, seconds. */
  extensionSec(id: string): number {
    const row = this.db.prepare('SELECT extension_sec FROM exam_students WHERE id = ?').get(id) as
      { extension_sec: number } | undefined;
    return row?.extension_sec ?? 0;
  }

  findById(id: string): ExamStudent | undefined {
    const row = this.db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
    return row && toStudent(row);
  }

  /** Marks the live socket state. Connecting and disconnecting both count as being seen. */
  setConnected(id: string, connected: boolean, now: number): void {
    this.db
      .prepare('UPDATE exam_students SET connected = ?, last_seen_at = ? WHERE id = ?')
      .run(connected ? 1 : 0, now, id);
  }

  /** A crash or restart leaves no socket open, so no row may stay `connected`. */
  resetConnections(): void {
    this.db.prepare('UPDATE exam_students SET connected = 0 WHERE connected = 1').run();
  }

  /** One student's roster row with the exam it belongs to. */
  rosterEntry(id: string): { examId: string; entry: RosterEntry } | undefined {
    const row = this.db.prepare(`${ROSTER_SELECT} WHERE s.id = ?`).get(id) as RosterRow | undefined;
    return row && { examId: row.exam_id, entry: toEntry(row) };
  }

  /** Students who accepted the notice (`not_joined` rows are hidden), by student code. */
  roster(examId: string): RosterEntry[] {
    const rows = this.db
      .prepare(
        `${ROSTER_SELECT} WHERE s.exam_id = ? AND s.state <> 'not_joined' ORDER BY c.student_code`,
      )
      .all(examId) as RosterRow[];
    return rows.map(toEntry);
  }

  counts(examId: string): HostingCounts {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(CASE WHEN state <> 'not_joined' THEN 1 END) AS joined,
           COUNT(CASE WHEN state = 'lobby' THEN 1 END) AS in_lobby,
           COUNT(CASE WHEN state = 'active' THEN 1 END) AS active,
           COUNT(CASE WHEN state = 'submitted' THEN 1 END) AS submitted,
           COUNT(CASE WHEN state <> 'not_joined' AND connected = 1 THEN 1 END) AS connected
         FROM exam_students WHERE exam_id = ?`,
      )
      .get(examId) as {
      joined: number;
      in_lobby: number;
      active: number;
      submitted: number;
      connected: number;
    };
    return {
      joined: row.joined,
      inLobby: row.in_lobby,
      active: row.active,
      submitted: row.submitted,
      connected: row.connected,
    };
  }
}

interface RosterRow {
  id: string;
  exam_id: string;
  student_code: string;
  name: string;
  state: StudentState;
  connected: number;
  risk_score: number;
  outside_ms_total: number;
  last_seen_at: number | null;
}

const ROSTER_SELECT = `SELECT s.id, s.exam_id, c.student_code, c.name, s.state, s.connected,
    s.risk_score, s.outside_ms_total, s.last_seen_at
  FROM exam_students s JOIN class_students c ON c.id = s.class_student_id`;

const toEntry = (row: RosterRow): RosterEntry => ({
  id: row.id,
  studentCode: row.student_code,
  name: row.name,
  state: row.state,
  connected: row.connected === 1,
  riskScore: row.risk_score,
  outsideMs: row.outside_ms_total,
  lastSeen: row.last_seen_at,
  // The hub replaces this with what the student's app last reported (`agent.status`, M21).
  agentOk: true,
  internetBlocked: false,
});

import {
  agentProblem,
  type AgentStatus,
  type RosterEntry,
  type ServerToStudent,
  type ServerToTeacher,
} from '@examguard/shared';
import type { ExamStudentRepo } from '../db/exam-student-repo.js';

/** A live student socket, as the hub sees it. */
export interface StudentConn {
  send(message: ServerToStudent): void;
  close(code: number, reason: string): void;
}

/** A subscribed teacher socket. */
export interface TeacherSub {
  examId: string;
  send(message: ServerToTeacher): void;
}

export interface SessionHubDeps {
  students: ExamStudentRepo;
  now?: () => number;
  /** Roster diffs are batched into one push per window. */
  batchMs?: number;
  /** A student's socket opened (`true`) or closed (`false`); a replaced socket is not a close. */
  onConnection?: (id: string, connected: boolean) => void;
}

/**
 * Live connections: which students have an open socket, and which teacher sockets want the roster.
 * Changes are coalesced per student and pushed at most once per batch window.
 */
export class SessionHub {
  private readonly conns = new Map<string, StudentConn>();
  private readonly subs = new Set<TeacherSub>();
  private readonly dirty = new Set<string>();
  /** Whether each student's monitoring agent was healthy at their last report. Not stored: a
   * restarted server hears it again from each student's welcome. */
  private readonly agentOk = new Map<string, boolean>();
  private timer: NodeJS.Timeout | null = null;
  private disposed = false;
  private readonly now: () => number;
  private readonly batchMs: number;

  constructor(private readonly deps: SessionHubDeps) {
    this.now = deps.now ?? Date.now;
    this.batchMs = deps.batchMs ?? 250;
  }

  /** Registers the socket. A socket already open for this student is closed as `replaced`. */
  attach(id: string, conn: StudentConn, replacedCode: number): void {
    const old = this.conns.get(id);
    this.conns.set(id, conn);
    if (old) old.close(replacedCode, 'replaced');
    this.deps.students.setConnected(id, true, this.now());
    this.deps.onConnection?.(id, true);
    this.changed(id);
  }

  /** Called when a socket closes. Ignored if a newer socket already took over. */
  detach(id: string, conn: StudentConn): void {
    // After dispose the database may already be closed; stale flags are reset on the next start.
    if (this.disposed || this.conns.get(id) !== conn) return;
    this.conns.delete(id);
    this.deps.students.setConnected(id, false, this.now());
    this.deps.onConnection?.(id, false);
    this.changed(id);
  }

  /** What the student's app says about its agent (`agent.status`); the roster shows it. */
  setAgent(id: string, status: AgentStatus): void {
    const ok = agentProblem(status) === null;
    if (this.agentOk.get(id) === ok) return;
    this.agentOk.set(id, ok);
    this.changed(id);
  }

  private withAgent(entry: RosterEntry): RosterEntry {
    return { ...entry, agentOk: this.agentOk.get(entry.id) ?? true };
  }

  isConnected(id: string): boolean {
    return this.conns.has(id);
  }

  /** Sends to one connected student. */
  sendTo(id: string, message: ServerToStudent): void {
    this.conns.get(id)?.send(message);
  }

  /** Sends to every connected student, building the message per student. */
  broadcast(build: (id: string) => ServerToStudent): void {
    for (const [id, conn] of [...this.conns]) conn.send(build(id));
  }

  /** Closes every student socket (hosting stopped). Rows are marked disconnected by `detach`. */
  closeAll(code: number, reason: string): void {
    for (const conn of [...this.conns.values()]) conn.close(code, reason);
  }

  /** Marks one student's roster row as needing a push. */
  changed(id: string): void {
    if (this.disposed) return;
    this.dirty.add(id);
    this.timer ??= setTimeout(() => this.flush(), this.batchMs);
  }

  /** Adds a teacher socket and sends it the full roster and counts. Returns the unsubscribe. */
  subscribe(sub: TeacherSub): () => void {
    this.subs.add(sub);
    const { students } = this.deps;
    sub.send({ t: 'roster', students: students.roster(sub.examId).map((e) => this.withAgent(e)) });
    sub.send({ t: 'hosting', ...students.counts(sub.examId) });
    return () => {
      this.subs.delete(sub);
    };
  }

  notice(level: 'info' | 'warn' | 'error', text: string): void {
    for (const sub of this.subs) sub.send({ t: 'notice', level, text });
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.dirty.clear();
    this.subs.clear();
  }

  private flush(): void {
    this.timer = null;
    const ids = [...this.dirty];
    this.dirty.clear();
    const changed = new Map<string, ReturnType<ExamStudentRepo['rosterEntry']>[]>();
    for (const id of ids) {
      const row = this.deps.students.rosterEntry(id);
      if (!row || row.entry.state === 'not_joined') continue;
      const list = changed.get(row.examId) ?? [];
      list.push(row);
      changed.set(row.examId, list);
    }
    for (const [examId, rows] of changed) {
      const targets = [...this.subs].filter((s) => s.examId === examId);
      if (targets.length === 0) continue;
      const students = rows.flatMap((r) => (r ? [this.withAgent(r.entry)] : []));
      const counts = this.deps.students.counts(examId);
      for (const sub of targets) {
        sub.send({ t: 'roster', students });
        sub.send({ t: 'hosting', ...counts });
      }
    }
  }
}

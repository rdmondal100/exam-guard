import type { EventRepo } from '../../db/repositories/event.repo.js';
import type { ExamRepo } from '../../db/repositories/exam.repo.js';
import type { ExamStudentRepo } from '../../db/repositories/examStudent.repo.js';
import type { EventRecorder } from '../events/event-recorder.js';

/** A student that stays disconnected this long has lost the network (architecture §6). */
export const NETWORK_GRACE_MS = 10_000;

const NETWORK_TYPES = ['network_lost', 'network_restored'] as const;

export interface ConnectionEventsDeps {
  students: Pick<ExamStudentRepo, 'findById'>;
  exams: Pick<ExamRepo, 'get'>;
  events: Pick<EventRepo, 'lastOfTypes'>;
  /** Classifies and stores the events (M31). */
  recorder: Pick<EventRecorder, 'record'>;
  now?: () => number;
  graceMs?: number;
}

/**
 * Turns socket changes into `network_lost` / `network_restored` events. The event is raised only
 * after the grace period and only while the exam runs, so a blip, the lobby and the end of the
 * exam stay quiet. Whether a student is "lost" is read back from the events table, not kept in
 * memory, so a server restart in the middle of an outage still produces the restored event.
 * The classifier makes `network_lost` medium and `network_restored` low (M31).
 */
export class ConnectionEvents {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly now: () => number;
  private readonly graceMs: number;

  constructor(private readonly deps: ConnectionEventsDeps) {
    this.now = deps.now ?? Date.now;
    this.graceMs = deps.graceMs ?? NETWORK_GRACE_MS;
  }

  /** The hub calls this when a student's socket opens or closes. */
  onConnection(studentId: string, connected: boolean): void {
    if (connected) {
      this.cancel(studentId);
      this.raiseRestored(studentId);
    } else if (!this.timers.has(studentId)) {
      const since = this.now();
      const timer = setTimeout(() => this.raiseLost(studentId, since), this.graceMs);
      this.timers.set(studentId, timer);
    }
  }

  /** Forgets every pending outage (hosting stopped or the server is closing). */
  reset(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private cancel(studentId: string): void {
    const timer = this.timers.get(studentId);
    if (timer) clearTimeout(timer);
    this.timers.delete(studentId);
  }

  private raiseLost(studentId: string, since: number): void {
    this.timers.delete(studentId);
    const student = this.deps.students.findById(studentId);
    if (!student || (student.state !== 'active' && student.state !== 'locked')) return;
    if (this.deps.exams.get(student.examId)?.state !== 'running') return;
    // One outage is one event, however many times the socket closes during it.
    if (this.deps.events.lastOfTypes(studentId, NETWORK_TYPES)?.type === 'network_lost') return;
    this.deps.recorder.record({
      examId: student.examId,
      examStudentId: studentId,
      type: 'network_lost',
      source: 'server',
      details: { since },
      serverTs: this.now(),
      dedupeKey: `server:network_lost:${studentId}:${since}`,
    });
  }

  private raiseRestored(studentId: string): void {
    const student = this.deps.students.findById(studentId);
    if (!student) return;
    const last = this.deps.events.lastOfTypes(studentId, NETWORK_TYPES);
    if (last?.type !== 'network_lost') return;
    const since = typeof last.details.since === 'number' ? last.details.since : last.serverTs;
    const at = this.now();
    this.deps.recorder.record({
      examId: student.examId,
      examStudentId: studentId,
      type: 'network_restored',
      source: 'server',
      details: { since, downMs: Math.max(0, at - since) },
      serverTs: at,
      dedupeKey: `server:network_restored:${studentId}:${last.id}`,
    });
  }
}

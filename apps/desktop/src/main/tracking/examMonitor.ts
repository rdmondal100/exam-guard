import { randomBytes } from 'node:crypto';
import type { EvidenceDetails, EvidenceKind, SessionState } from '@examguard/shared';
import type { Evidence, Tracker } from './tracker.js';

/** What the monitor needs from the live session. */
export interface MonitorSession {
  /** The student this session belongs to, or `null` before joining. */
  examStudentId(): string | null;
  sendEvidence(evidence: {
    key: string;
    type: EvidenceKind;
    clientTs: number;
    details: EvidenceDetails;
    jpeg?: Uint8Array;
  }): void;
}

/** Whether the app must be watching this student right now, from the server's state. */
export function wantsMonitoring(exam: SessionState): boolean {
  if (!exam.monitoring || !exam.monitoringPolicy || exam.receipt) return false;
  if (exam.examState !== 'running') return false;
  return exam.studentState === 'active' || exam.studentState === 'locked';
}

/**
 * Runs the tracker while the exam runs for this student, stops it when they submit or the exam
 * ends, and hands what it saw to the server. Each piece of evidence gets a key that is unique for
 * this student and this run of the app, so the server stores a resend once.
 */
export class ExamMonitor {
  private active: { examStudentId: string; policy: string } | null = null;
  /** The student the evidence belongs to; kept after `stop` until the session ends. */
  private student: string | null = null;
  private seq = 0;
  private readonly runId: string;

  constructor(
    private readonly tracker: Pick<Tracker, 'start' | 'stop'>,
    private readonly session: MonitorSession,
    runId = randomBytes(4).toString('hex'),
  ) {
    this.runId = runId;
  }

  /** Call with every exam state the session delivers. */
  onExam(exam: SessionState): void {
    const examStudentId = this.session.examStudentId();
    if (wantsMonitoring(exam) && exam.monitoringPolicy && examStudentId) {
      const policy = JSON.stringify(exam.monitoringPolicy);
      if (this.active?.examStudentId === examStudentId && this.active.policy === policy) return;
      this.active = { examStudentId, policy };
      this.student = examStudentId;
      this.tracker.start(exam.monitoringPolicy);
    } else {
      this.stop();
    }
  }

  /** The session ended (Leave): stop watching and forget the student. */
  reset(): void {
    this.stop();
    this.student = null;
  }

  /** What the tracker saw. Also after `stop`: what it saw just before still counts. */
  evidence({ kind, ts, details, jpeg }: Evidence): void {
    const student = this.student;
    if (!student) return;
    this.seq += 1;
    this.session.sendEvidence({
      key: `${student}:${this.runId}:${this.seq}`,
      type: kind,
      clientTs: ts,
      details,
      ...(jpeg ? { jpeg } : {}),
    });
  }

  private stop(): void {
    if (!this.active) return;
    this.active = null;
    this.tracker.stop();
  }
}

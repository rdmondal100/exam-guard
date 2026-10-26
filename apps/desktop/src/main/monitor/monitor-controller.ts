import type { AgentEventType, SessionState } from '@examguard/shared';
import type { AgentEvidence, AgentLink } from '../agent/agent-link.js';

/** What the controller needs from the live session. */
export interface MonitorSession {
  /** The student this session belongs to, or `null` before joining. */
  examStudentId(): string | null;
  sendEvidence(
    evidence: {
      key: string;
      type: AgentEventType;
      clientTs: number;
      details: Record<string, unknown>;
      jpeg?: Uint8Array;
    },
    onAcked: () => void,
  ): void;
}

/** Whether the agent must be watching this student right now, from the server's state. */
export function wantsMonitoring(exam: SessionState): boolean {
  if (!exam.monitoring || !exam.monitoringPolicy || exam.receipt) return false;
  if (exam.examState !== 'running') return false;
  return exam.studentState === 'active' || exam.studentState === 'locked';
}

function detailsOf(data: AgentEvidence['data']): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(data)) {
    if (value !== undefined) details[name] = value;
  }
  return details;
}

/**
 * Starts the agent's monitoring while the exam runs for this student, stops it when they submit or
 * the exam ends, and hands what the agent saw to the server. The agent keeps each piece of evidence
 * until it is told the server stored it, so this only acks what the server acked: up to the number
 * below which nothing is still in flight.
 */
export class MonitorController {
  private active: { examStudentId: string; policy: string } | null = null;
  /** The student the evidence belongs to; kept after `stop` until the session ends. */
  private student: string | null = null;
  /** Evidence numbers sent to the server and not acked yet. */
  private readonly inFlight = new Set<number>();
  private highest = 0;
  private acked = 0;
  private readonly stopListening: () => void;

  constructor(
    private readonly link: Pick<AgentLink, 'setMonitoring' | 'onEvidence' | 'ackEvidence'>,
    private readonly session: MonitorSession,
  ) {
    this.stopListening = link.onEvidence((evidence) => this.onEvidence(evidence));
  }

  /** Call with every exam state the session delivers. */
  onExam(exam: SessionState): void {
    const examStudentId = this.session.examStudentId();
    if (wantsMonitoring(exam) && exam.monitoringPolicy && examStudentId) {
      const policy = JSON.stringify(exam.monitoringPolicy);
      if (this.active?.examStudentId === examStudentId && this.active.policy === policy) return;
      this.active = { examStudentId, policy };
      this.student = examStudentId;
      this.inFlight.clear();
      this.link.setMonitoring({ examStudentId, policy: exam.monitoringPolicy });
    } else {
      this.stop();
    }
  }

  /** The session ended (Leave): stop watching and forget the student. */
  reset(): void {
    this.stop();
    this.student = null;
  }

  dispose(): void {
    this.stopListening();
  }

  private stop(): void {
    if (!this.active) return;
    this.active = null;
    this.inFlight.clear();
    this.link.setMonitoring(null);
  }

  private onEvidence(evidence: AgentEvidence): void {
    // Also after `stop`: what the agent saw just before it was told to stop still counts.
    const student = this.student;
    if (!student || evidence.evidenceSeq <= this.acked) return;
    const seq = evidence.evidenceSeq;
    this.highest = Math.max(this.highest, seq);
    this.inFlight.add(seq);
    this.session.sendEvidence(
      {
        key: `${student}:${seq}`,
        type: evidence.kind,
        clientTs: evidence.ts,
        details: detailsOf(evidence.data),
        ...(evidence.screenshot
          ? { jpeg: new Uint8Array(Buffer.from(evidence.screenshot.jpegBase64, 'base64')) }
          : {}),
      },
      () => this.onAcked(seq),
    );
  }

  private onAcked(seq: number): void {
    this.inFlight.delete(seq);
    const below = this.inFlight.size > 0 ? Math.min(...this.inFlight) - 1 : this.highest;
    if (below <= this.acked) return;
    this.acked = below;
    this.link.ackEvidence(below);
  }
}

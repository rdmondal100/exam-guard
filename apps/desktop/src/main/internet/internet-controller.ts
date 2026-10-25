import type { AppEventType, SessionState } from '@examguard/shared';
import type { AgentLink, InternetOutcome } from '../agent/agent-link.js';

/** What the controller needs from the live session. */
export interface InternetSession {
  /** The exam server's address, or `null` when there is no session. */
  readonly teacherAddress: string | null;
  setInternetStatus(blocked: boolean, error: string | null): void;
  sendEvent(type: AppEventType, details: Record<string, unknown>): void;
}

/** Whether this PC's internet must be off right now, from the server's state. */
export function wantsBlock(exam: SessionState): boolean {
  if (exam.internet !== 'blocked' || exam.receipt) return false;
  if (exam.examState !== 'hosting' && exam.examState !== 'running') return false;
  return exam.studentState !== 'submitted' && exam.studentState !== 'ended_by_teacher';
}

const NO_ADDRESS = 'The exam server address is not known.';

/**
 * Applies the teacher's internet switch through the agent and reports back: the confirmed state to
 * the server (the roster), and `internet_blocked` / `internet_allowed` / `internet_block_failed`
 * as events. The agent does the blocking; this only decides when, and says what happened.
 */
export class InternetController {
  private wanted = false;
  private reported: string | null = null;
  private failure: string | null = null;
  private readonly stopListening: () => void;

  constructor(
    private readonly link: Pick<AgentLink, 'setInternet' | 'onInternet'>,
    private readonly session: InternetSession,
  ) {
    this.stopListening = link.onInternet((outcome) => this.onOutcome(outcome));
  }

  /** Call with every exam state the session delivers. */
  onExam(exam: SessionState): void {
    const wants = wantsBlock(exam);
    if (wants) {
      const address = this.session.teacherAddress;
      this.wanted = true;
      if (address) this.link.setInternet(true, [address]);
      else this.onOutcome({ blocked: false, error: NO_ADDRESS });
    } else if (this.wanted) {
      this.wanted = false;
      this.link.setInternet(false, []);
    }
  }

  /** The session ended (Leave): lift the block. */
  reset(): void {
    if (!this.wanted) return;
    this.wanted = false;
    this.link.setInternet(false, []);
  }

  dispose(): void {
    this.stopListening();
  }

  private onOutcome(outcome: InternetOutcome): void {
    const key = `${outcome.blocked}|${outcome.error ?? ''}|${this.wanted}`;
    if (key === this.reported) return;
    const wasBlocked = this.reported?.startsWith('true|') ?? false;
    this.reported = key;
    this.session.setInternetStatus(outcome.blocked, outcome.error);
    if (outcome.blocked && !wasBlocked) {
      this.failure = null;
      this.session.sendEvent('internet_blocked', { allow: this.session.teacherAddress });
    } else if (!outcome.blocked && wasBlocked) {
      this.session.sendEvent('internet_allowed', { reason: this.wanted ? 'lost' : 'teacher' });
    }
    if (this.wanted && !outcome.blocked && outcome.error && outcome.error !== this.failure) {
      this.failure = outcome.error;
      this.session.sendEvent('internet_block_failed', { error: outcome.error });
    }
  }
}

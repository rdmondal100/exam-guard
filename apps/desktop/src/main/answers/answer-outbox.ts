import { randomUUID } from 'node:crypto';
import type { AnswerSave, AnswerSaveRequest, AnswerStatus, SavedAnswer } from '@examguard/shared';

/** Unacked saves kept in memory; the oldest are dropped past this. The disk queue is M17. */
export const MAX_PENDING_SAVES = 500;

/**
 * The saves the server has not acked yet, and the counter that numbers them. `clientSeq` only
 * goes up, and after a welcome it continues past the newest number the server already stored, so
 * a restarted app can never reuse one (the server keeps each number once).
 */
export class AnswerOutbox {
  private nextSeq = 1;
  private readonly pending = new Map<number, AnswerSave>();
  private lastAckAt: number | null = null;

  constructor(
    private readonly onStatus: (status: AnswerStatus) => void = () => {},
    private readonly max = MAX_PENDING_SAVES,
  ) {}

  /** Numbers a save and keeps it until it is acked. `serverNow` stamps it in server time. */
  add(request: AnswerSaveRequest, serverNow: number): AnswerSave {
    const save: AnswerSave = {
      t: 'answer.save',
      id: randomUUID(),
      clientSeq: this.nextSeq,
      clientTs: serverNow,
      ...request,
    };
    this.nextSeq += 1;
    this.pending.set(save.clientSeq, save);
    if (this.pending.size > this.max) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
    this.report();
    return save;
  }

  ack(clientSeq: number, now: number): void {
    if (!this.pending.delete(clientSeq)) return;
    this.lastAckAt = now;
    this.report();
  }

  /** After a welcome: never reuse a number the server already holds. */
  continueAfter(saved: readonly SavedAnswer[]): void {
    for (const s of saved) this.nextSeq = Math.max(this.nextSeq, s.clientSeq + 1);
  }

  /** Everything not acked, oldest first: re-sent after every welcome. */
  unacked(): AnswerSave[] {
    return [...this.pending.values()];
  }

  status(): AnswerStatus {
    return { pending: this.pending.size, lastAckAt: this.lastAckAt };
  }

  private report(): void {
    this.onStatus(this.status());
  }
}

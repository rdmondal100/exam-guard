import { randomUUID } from 'node:crypto';
import type { AnswerSave, AnswerSaveRequest, AnswerStatus, SavedAnswer } from '@examguard/shared';

/** Unacked saves kept in memory and in the disk queue; the oldest are dropped past this. */
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
    /** Called for a save pushed out by the cap, so the disk queue can forget it too. */
    private readonly onDrop: (save: AnswerSave) => void = () => {},
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
    this.keep(save);
    this.report();
    return save;
  }

  /** Puts back saves read from the disk queue and moves the counter past them. */
  restore(saves: readonly AnswerSave[]): void {
    for (const save of [...saves].sort((a, b) => a.clientSeq - b.clientSeq)) {
      this.nextSeq = Math.max(this.nextSeq, save.clientSeq + 1);
      this.keep(save);
    }
    this.report();
  }

  private keep(save: AnswerSave): void {
    this.pending.set(save.clientSeq, save);
    if (this.pending.size > this.max) {
      const oldest = this.pending.keys().next().value;
      const dropped = oldest === undefined ? undefined : this.pending.get(oldest);
      if (oldest !== undefined) this.pending.delete(oldest);
      if (dropped) this.onDrop(dropped);
    }
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

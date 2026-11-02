import { randomUUID } from 'node:crypto';
import type { TeacherMessageToStudent } from '@examguard/shared';
import type { SessionHub } from '../../sockets/sessionHub.js';

/** Unshown messages kept per student; the oldest go first. */
const MAX_PENDING = 20;

export interface TeacherMessagesDeps {
  hub: Pick<SessionHub, 'sendTo' | 'isConnected'>;
  now: () => number;
}

/**
 * Teacher messages and warnings (M35). Each is sent at once when the student is connected and
 * re-sent after every `welcome` until their app answers `ack`, so a student who was offline still
 * sees it. Kept in memory only: a server restart forgets the unshown ones (the audit log keeps
 * the text).
 */
export class TeacherMessages {
  private readonly pending = new Map<string, TeacherMessageToStudent[]>();

  constructor(private readonly deps: TeacherMessagesDeps) {}

  /** Queues and sends one message. Returns whether the student's app was connected. */
  send(studentId: string, kind: 'info' | 'warning', text: string): boolean {
    const message: TeacherMessageToStudent = {
      t: 'message',
      id: randomUUID(),
      kind,
      text,
      sentAt: this.deps.now(),
    };
    const list = this.pending.get(studentId) ?? [];
    list.push(message);
    if (list.length > MAX_PENDING) list.shift();
    this.pending.set(studentId, list);
    const delivered = this.deps.hub.isConnected(studentId);
    this.deps.hub.sendTo(studentId, message);
    return delivered;
  }

  /** A new socket got its `welcome`: everything not yet shown goes again, oldest first. */
  onWelcome(studentId: string): void {
    for (const message of this.pending.get(studentId) ?? []) {
      this.deps.hub.sendTo(studentId, message);
    }
  }

  /** The student's app showed it. */
  ack(studentId: string, id: string): void {
    const list = this.pending.get(studentId);
    if (!list) return;
    const left = list.filter((m) => m.id !== id);
    if (left.length > 0) this.pending.set(studentId, left);
    else this.pending.delete(studentId);
  }

  pendingFor(studentId: string): number {
    return this.pending.get(studentId)?.length ?? 0;
  }

  /** Hosting stopped. */
  reset(): void {
    this.pending.clear();
  }
}

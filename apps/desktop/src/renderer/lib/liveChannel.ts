import type { LiveClose, LiveOpen, LiveSession, RtcSignal, RtcSignalData } from '@examguard/shared';

/** What a live view gets: its session's status changes and the student's signals. */
export type LiveEvent =
  { kind: 'status'; session: LiveSession } | { kind: 'signal'; data: RtcSignalData };

export interface LiveHandle {
  signal(data: RtcSignalData): void;
  close(): void;
}

type Outgoing = LiveOpen | LiveClose | RtcSignal;

interface Entry {
  examStudentId: string;
  sessionId: string | null;
  closed: boolean;
  listener: (event: LiveEvent) => void;
}

/**
 * The teacher's live view sessions on one socket (M34). `open` sends `live.open`; the server
 * answers with a `live.session` that names the session, matched to the oldest open for that student
 * still waiting. After that, signals and status go by session id. When the socket drops, the
 * server ends every session of it, so each open view is told it ended.
 */
export class LiveChannel {
  private send: ((message: Outgoing) => void) | null = null;
  private readonly entries: Entry[] = [];

  /** The socket opened (a sender) or closed (`null`). */
  setSender(send: ((message: Outgoing) => void) | null): void {
    this.send = send;
    if (send) return;
    for (const entry of this.entries.splice(0)) {
      if (entry.closed) continue;
      entry.listener({
        kind: 'status',
        session: {
          t: 'live.session',
          sessionId: entry.sessionId ?? '',
          examStudentId: entry.examStudentId,
          status: 'ended',
          reason: 'closed',
        },
      });
    }
  }

  get connected(): boolean {
    return this.send !== null;
  }

  open(examStudentId: string, listener: (event: LiveEvent) => void): LiveHandle {
    const entry: Entry = { examStudentId, sessionId: null, closed: false, listener };
    if (!this.send) {
      listener({
        kind: 'status',
        session: {
          t: 'live.session',
          sessionId: '',
          examStudentId,
          status: 'failed',
          reason: 'closed',
        },
      });
      return { signal: () => undefined, close: () => undefined };
    }
    this.entries.push(entry);
    this.send({ t: 'live.open', examStudentId });
    return {
      signal: (data) => {
        if (!entry.closed && entry.sessionId) {
          this.send?.({ t: 'rtc.signal', sessionId: entry.sessionId, data });
        }
      },
      close: () => {
        if (entry.closed) return;
        entry.closed = true;
        // Without an id yet, the close goes out when the server names the session.
        if (entry.sessionId) {
          this.send?.({ t: 'live.close', sessionId: entry.sessionId });
          this.remove(entry);
        }
      },
    };
  }

  /** A `live.session` or `rtc.signal` from the server. */
  handle(message: LiveSession | RtcSignal): void {
    if (message.t === 'rtc.signal') {
      const entry = this.entries.find((e) => e.sessionId === message.sessionId);
      if (entry && !entry.closed) entry.listener({ kind: 'signal', data: message.data });
      return;
    }
    let entry = this.entries.find((e) => e.sessionId === message.sessionId);
    if (!entry) {
      entry = this.entries.find(
        (e) => e.sessionId === null && e.examStudentId === message.examStudentId,
      );
      if (!entry) return;
      entry.sessionId = message.sessionId;
      if (entry.closed) {
        if (message.status === 'connecting') {
          this.send?.({ t: 'live.close', sessionId: message.sessionId });
        }
        return this.remove(entry);
      }
    }
    if (message.status === 'ended' || message.status === 'failed') this.remove(entry);
    if (!entry.closed) entry.listener({ kind: 'status', session: message });
  }

  /** Open sessions, for tests. */
  count(): number {
    return this.entries.length;
  }

  private remove(entry: Entry): void {
    const index = this.entries.indexOf(entry);
    if (index >= 0) this.entries.splice(index, 1);
  }
}

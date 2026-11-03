import {
  MAX_LIVE_PER_TEACHER,
  type LivePageMessage,
  type LiveRequest,
  type LiveStart,
  type LiveState,
  type RtcSignal,
  type RtcSignalData,
} from '@examguard/shared';

/** One hidden capture page with its peer connection (`live-window.ts`). */
export interface LivePeerWindow {
  start(start: LiveStart & { sourceId: string }): void;
  signal(data: RtcSignalData): void;
  destroy(): void;
}

export interface LiveViewsDeps {
  /** Opens a capture page; `onMessage` gets what it sends, `onGone` fires if it dies by itself. */
  open(onMessage: (message: LivePageMessage) => void, onGone: () => void): LivePeerWindow;
  /** The primary screen's capture source, `null` when Windows gives none. */
  sourceId(): Promise<string | null>;
  /** To the server (dropped while the link is down). */
  send(message: RtcSignal | LiveState): void;
}

/** Live views one student app runs at once (two teacher sockets could each open two). */
export const MAX_LIVE_SESSIONS = MAX_LIVE_PER_TEACHER;

/**
 * The student side of the WebRTC live view (M34; docs/architecture.md §5). Each `live.request`
 * gets its own hidden page that captures the primary screen and sends the offer; the page is
 * destroyed on `live.stop`, when monitoring ends, when the socket closes or when it fails, so no
 * peer connection outlives its session. Only while monitoring (the exam runs), like thumbnails.
 */
export class LiveViews {
  private monitoring = false;
  private readonly open = new Map<string, LivePeerWindow>();
  /** Requests waiting for the capture source; a stop in between cancels them. */
  private readonly pending = new Set<string>();

  constructor(private readonly deps: LiveViewsDeps) {}

  setMonitoring(on: boolean): void {
    this.monitoring = on;
    if (!on) this.endAll(true);
  }

  async request(request: LiveRequest): Promise<void> {
    const { sessionId } = request;
    if (!this.monitoring) return this.fail(sessionId, 'not monitoring');
    if (this.open.has(sessionId) || this.pending.has(sessionId)) return;
    this.pending.add(sessionId);
    const sourceId = await this.deps.sourceId().catch(() => null);
    if (!this.pending.delete(sessionId)) return;
    if (!this.monitoring) return this.fail(sessionId, 'not monitoring');
    if (!sourceId) return this.fail(sessionId, 'no screen to capture');
    // The oldest view gives way, so a teacher who opens a new one always gets it.
    while (this.open.size >= MAX_LIVE_SESSIONS) {
      const oldest = this.open.keys().next().value;
      if (oldest === undefined) break;
      this.close(oldest, 'ended');
    }
    const page = this.deps.open(
      (message) => this.fromPage(sessionId, message),
      () => {
        if (this.open.delete(sessionId)) this.state(sessionId, 'failed', 'capture page closed');
      },
    );
    this.open.set(sessionId, page);
    page.start({ sessionId, maxWidth: request.maxWidth, fps: request.fps, sourceId });
  }

  /** A signal from the teacher for an open view. */
  signal(sessionId: string, data: RtcSignalData): void {
    this.open.get(sessionId)?.signal(data);
  }

  /** `live.stop`: the server already ended it. */
  stop(sessionId: string): void {
    this.pending.delete(sessionId);
    const page = this.open.get(sessionId);
    this.open.delete(sessionId);
    page?.destroy();
  }

  /** The socket closed: the server ended every session of it, so nothing is reported. */
  socketClosed(): void {
    this.endAll(false);
  }

  /** Open views, for tests. */
  count(): number {
    return this.open.size;
  }

  private fromPage(sessionId: string, message: LivePageMessage): void {
    if (message.sessionId !== sessionId || !this.open.has(sessionId)) return;
    if (message.kind === 'signal') {
      return this.deps.send({ t: 'rtc.signal', sessionId, data: message.data });
    }
    this.close(sessionId, message.status, message.reason);
  }

  private close(sessionId: string, status: 'failed' | 'ended', reason?: string): void {
    const page = this.open.get(sessionId);
    this.open.delete(sessionId);
    page?.destroy();
    this.state(sessionId, status, reason);
  }

  private endAll(report: boolean): void {
    this.pending.clear();
    for (const sessionId of [...this.open.keys()]) {
      if (report) this.close(sessionId, 'ended', 'monitoring ended');
      else this.stop(sessionId);
    }
  }

  private fail(sessionId: string, reason: string): void {
    this.state(sessionId, 'failed', reason);
  }

  private state(sessionId: string, status: 'failed' | 'ended', reason?: string): void {
    this.deps.send({
      t: 'live.state',
      sessionId,
      status,
      ...(reason ? { reason: reason.slice(0, 200) } : {}),
    });
  }
}

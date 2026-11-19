import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  PROTOCOL_VERSION,
  STUDENT_PING_MS,
  ServerToStudentSchema,
  WS_CLOSE,
  encodeScreenshotFrames,
  encodeThumbFrame,
  type AnswerSave,
  type AnswerSaveRequest,
  type AnswerStatus,
  type AppEventType,
  type EventReport,
  type EvidenceKind,
  type LiveRequest,
  type LiveState,
  type LiveStop,
  type MonitorStatus,
  type ReadinessReport,
  type RtcSignal,
  type SessionState,
  type SessionStatus,
  type Submit,
  type SubmitOutcome,
  type TeacherMessageToStudent,
  type ThumbStart,
  type TranscriptChunk,
} from '@examguard/shared';

/** Unacked events kept in memory; the oldest are dropped past this. */
export const MAX_PENDING_EVENTS = 500;
/** Unacked transcript chunks kept in memory (16 KB each at most). */
export const MAX_PENDING_TRANSCRIPT = 128;
/** Screenshots of unacked events kept in memory; past this the oldest go without a picture (M61). */
export const MAX_PENDING_PICTURE_BYTES = 50 * 1024 * 1024;
/** A clock sample older than this is replaced by the next one even with a slower round trip (M64). */
const CLOCK_SAMPLE_MAX_AGE_MS = 60_000;
import { AnswerOutbox, MAX_PENDING_SAVES } from '../answers/answerOutbox.js';
import { queueKey, type OfflineQueue } from '../resume/offlineQueue.js';
import { PinError, connectPinned, type PinnedTarget } from '../utils/tlsPin.js';

/** 0.5 s → 5 s doubling, with jitter so 200 students do not reconnect in step. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(5000, 500 * 2 ** attempt);
  return Math.round(base * (0.5 + random() * 0.5));
}

export interface SessionClientDeps {
  onStatus: (status: SessionStatus) => void;
  /** How many autosaves wait for the server: after each save and each ack. */
  onAnswers?: (status: AnswerStatus) => void;
  /** The latest exam state: on every welcome and after each `state` push. */
  onExam?: (state: SessionState) => void;
  /** The session was stopped for good (Leave), not restarted: nothing may stay locked down. */
  onStop?: () => void;
  /**
   * The server wants grid thumbnails (`thumb.start`) or no longer does (`null`: `thumb.stop`, or the
   * socket closed; a new socket is asked again). M33.
   */
  onThumbs?: (command: ThumbStart | null) => void;
  /**
   * WebRTC live view (M34): a request, a stop or a signal from the teacher; `null` when the socket
   * closed (the server ends every session of that socket).
   */
  onLive?: (message: LiveRequest | LiveStop | RtcSignal | null) => void;
  /** A teacher message or warning (M35), each id once; it is acked as soon as it is handed over. */
  onTeacherMessage?: (message: TeacherMessageToStudent) => void;
  pingMs?: number;
  random?: () => number;
  /** A monotonic clock in ms (`performance.now`); the server clock is anchored on it (M64). */
  perfNow?: () => number;
}

/** Closes after which retrying cannot help. */
const FINAL: Record<number, string> = {
  [WS_CLOSE.unauthorized]: 'unauthorized',
  [WS_CLOSE.protocolMismatch]: 'protocol_mismatch',
  [WS_CLOSE.replaced]: 'replaced',
};

/**
 * The student's live socket, in main. Pins the cert before the first byte, says hello, keeps the
 * link alive with ping/pong (also giving the server clock offset) and reconnects with backoff.
 */
export class SessionClient {
  private target: PinnedTarget | null = null;
  private token = '';
  private socket: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private offsetMs: number | null = null;
  private bestRtt = Infinity;
  /**
   * The server clock, anchored on the monotonic clock (M64): `server` was the server's time at
   * monotonic `perf`. A jump of the PC's wall clock changes nothing here; `offsetMs` (server minus
   * wall clock) is recomputed from it on every pong.
   */
  private anchor: { server: number; perf: number; takenAt: number } | null = null;
  /** Monotonic send time of each unanswered ping, by its `clientSent`. */
  private readonly pings = new Map<number, number>();
  private generation = 0;
  private exam: SessionState | null = null;
  private welcomed: WebSocket | null = null;
  /** The monitor's latest self-check, sent after each welcome and whenever it changes. */
  private monitorStatus: MonitorStatus | null = null;
  /** The lobby readiness check's last result (M54), re-sent after every welcome. */
  private readiness: ReadinessReport | null = null;
  /** Sent events waiting for `event.ack`, in send order. */
  private readonly pending = new Map<string, EventReport>();
  /** Sent transcript chunks waiting for `transcript.ack`, in send order. */
  private readonly pendingTranscript = new Map<string, TranscriptChunk>();
  /**
   * The screenshots of the monitor's events in `pending` (M22), sent as binary frames just before
   * the event. They stay in memory only: after a restart the event goes out without its picture.
   */
  private readonly pictures = new Map<string, Uint8Array>();
  private pictureBytes = 0;

  /** Autosaves waiting for `answer.ack`, and the counter that numbers them. */
  private readonly answers: AnswerOutbox;
  /** Everything unacked is mirrored here, so a restart does not lose it. */
  private queue: OfflineQueue | null = null;
  private watchTimer: NodeJS.Timeout | null = null;
  private lastReceived = 0;
  /** Teacher message ids already shown, so a resend after a reconnect shows nothing twice. */
  private readonly shownMessages = new Set<string>();
  /** The Submit the student asked for, until the server answers. */
  private pendingSubmit: {
    frame: Submit;
    promise: Promise<SubmitOutcome>;
    settle: (outcome: SubmitOutcome) => void;
  } | null = null;

  constructor(private readonly deps: SessionClientDeps) {
    this.answers = new AnswerOutbox(
      (status) => deps.onAnswers?.(status),
      MAX_PENDING_SAVES,
      (dropped) => this.queue?.remove(queueKey(dropped)),
    );
  }

  /** Tells the server how the monitor's self-check looks; it is also re-sent after every welcome. */
  setMonitorStatus(status: MonitorStatus): void {
    this.monitorStatus = status;
    if (this.welcomed) this.sendFrame(this.welcomed, { t: 'monitor.status', ...status });
  }

  /** The lobby readiness check's result (M54); the teacher's roster shows it. */
  setReadiness(report: ReadinessReport): void {
    this.readiness = report;
    if (this.welcomed) this.sendFrame(this.welcomed, { t: 'readiness.report', ...report });
  }

  /** Saves one answer buffer. It is re-sent after every reconnect until the server acks it. */
  sendAnswer(request: AnswerSaveRequest): void {
    const save = this.answers.add(request, this.serverNow());
    this.queue?.add(save);
    if (this.welcomed) this.sendFrame(this.welcomed, save);
  }

  get answerStatus(): AnswerStatus {
    return this.answers.status();
  }

  /** The saves the server has not acked yet, oldest first. */
  unackedSaves(): AnswerSave[] {
    return this.answers.unacked();
  }

  /** The latest exam state, or `null` before the first welcome. */
  get examState(): SessionState | null {
    return this.exam;
  }

  /** Reports an app event. It is re-sent after every reconnect until the server acks it. */
  sendEvent(type: AppEventType, details: Record<string, unknown>): void {
    const id = randomUUID();
    const event: EventReport = {
      t: 'event',
      id,
      dedupeKey: id,
      clientTs: this.serverNow(),
      type,
      details,
    };
    this.pending.set(id, event);
    this.queue?.add(event);
    this.trimPending();
    if (this.welcomed) this.sendFrame(this.welcomed, event);
  }

  /**
   * Reports something the monitor saw. `key` is its dedupe key and its screenshot reference. It is
   * re-sent after every reconnect until the server acks it, and kept in the offline queue (without
   * the picture) so a restart does not lose it. Giving the same key again changes nothing.
   */
  sendEvidence(evidence: {
    key: string;
    type: EvidenceKind;
    clientTs: number;
    details: Record<string, unknown>;
    jpeg?: Uint8Array;
  }): void {
    const { key, type, clientTs, details, jpeg } = evidence;
    if (this.pending.has(key)) return;
    const event: EventReport = { t: 'event', id: key, dedupeKey: key, clientTs, type, details };
    this.queue?.add(event);
    const sent = jpeg ? { ...event, screenshotRef: key } : event;
    this.pending.set(key, sent);
    if (jpeg) this.keepPicture(key, jpeg);
    this.trimPending();
    if (this.welcomed) this.sendEventFrames(this.welcomed, sent);
  }

  /** Keeps the memory bounded: the oldest unacked events go first. */
  private trimPending(): void {
    if (this.pending.size <= MAX_PENDING_EVENTS) return;
    const oldest = this.pending.keys().next().value;
    if (oldest === undefined) return;
    this.pending.delete(oldest);
    this.dropPicture(oldest);
    this.queue?.remove(`e${oldest}`);
  }

  /**
   * Keeps a screenshot until its event is acked. A long outage would otherwise hold hundreds of
   * full-screen pictures: past the cap the oldest events go on without theirs (M61).
   */
  private keepPicture(key: string, jpeg: Uint8Array): void {
    this.pictures.set(key, jpeg);
    this.pictureBytes += jpeg.byteLength;
    while (this.pictureBytes > MAX_PENDING_PICTURE_BYTES && this.pictures.size > 1) {
      const oldest = this.pictures.keys().next().value;
      if (oldest === undefined) break;
      this.dropPicture(oldest);
      const event = this.pending.get(oldest);
      if (event?.screenshotRef) {
        const withoutPicture: EventReport = { ...event };
        delete withoutPicture.screenshotRef;
        this.pending.set(oldest, withoutPicture);
      }
    }
  }

  private dropPicture(key: string): void {
    const jpeg = this.pictures.get(key);
    if (!jpeg) return;
    this.pictures.delete(key);
    this.pictureBytes -= jpeg.byteLength;
  }

  /** Events and terminal transcript the server has not acked yet (M60: shut down waits for them). */
  get pendingEvidence(): number {
    return this.pending.size + this.pendingTranscript.size;
  }

  /** The server's clock now, as well as it is known (the PC's clock before the first sample). */
  serverNow(): number {
    if (!this.anchor) return Date.now() + (this.offsetMs ?? 0);
    return Math.round(this.anchor.server + (this.perfNow() - this.anchor.perf));
  }

  private perfNow(): number {
    return this.deps.perfNow ? this.deps.perfNow() : performance.now();
  }

  /** An event, preceded by its screenshot when it has one (the server waits for the pieces). */
  private sendEventFrames(ws: WebSocket, event: EventReport): void {
    const jpeg = this.pictures.get(event.id);
    if (jpeg && ws.readyState === WebSocket.OPEN) {
      for (const frame of encodeScreenshotFrames(event.id, jpeg)) ws.send(frame, { binary: true });
    }
    this.sendFrame(ws, event);
  }

  /** Sends one grid thumbnail now, or drops it while the link is down (only the newest matters). */
  sendThumb(jpeg: Uint8Array, capturedAt: number): void {
    const ws = this.welcomed;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(encodeThumbFrame({ ts: capturedAt }, jpeg), { binary: true });
  }

  /** Sends a live view signal or state now, or drops it while the link is down (the session is over then). */
  sendLive(message: RtcSignal | LiveState): void {
    const ws = this.welcomed;
    if (ws) this.sendFrame(ws, message);
  }

  /** Sends a piece of the terminal transcript; re-sent after reconnects until acked. */
  sendTranscript(key: string, text: string): void {
    const chunk: TranscriptChunk = { t: 'transcript', key, clientTs: this.serverNow(), text };
    this.pendingTranscript.set(key, chunk);
    this.queue?.add(chunk);
    if (this.pendingTranscript.size > MAX_PENDING_TRANSCRIPT) {
      const oldest = this.pendingTranscript.keys().next().value;
      if (oldest !== undefined) {
        this.pendingTranscript.delete(oldest);
        this.queue?.remove(`c${oldest}`);
      }
    }
    if (this.welcomed) this.sendFrame(this.welcomed, chunk);
  }

  /**
   * Asks the server to make the answers final. The frame is re-sent after every reconnect, after
   * the unacked saves, until the server answers; the receipt arrives as `state.receipt` through
   * `onExam`. A second call while one is pending shares its outcome.
   */
  submit(): Promise<SubmitOutcome> {
    if (this.exam?.receipt) return Promise.resolve({ ok: true });
    if (this.pendingSubmit) return this.pendingSubmit.promise;
    const frame: Submit = {
      t: 'submit',
      id: randomUUID(),
      clientTs: this.serverNow(),
    };
    let settle: (outcome: SubmitOutcome) => void = () => {};
    const promise = new Promise<SubmitOutcome>((resolve) => (settle = resolve));
    this.pendingSubmit = { frame, promise, settle };
    if (this.welcomed) this.sendFrame(this.welcomed, frame);
    return promise;
  }

  private settleSubmit(outcome: SubmitOutcome): void {
    const pending = this.pendingSubmit;
    this.pendingSubmit = null;
    pending?.settle(outcome);
  }

  private sendFrame(ws: WebSocket, frame: object): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  }

  /**
   * Starts (or restarts) the session. The token never leaves main. With a `queue`, what an earlier
   * run left unacked is loaded and sent after the first welcome, and new frames are kept in it.
   */
  start(target: PinnedTarget, token: string, queue?: OfflineQueue): void {
    this.halt();
    this.queue = queue ?? null;
    if (queue) this.load(queue);
    this.target = target;
    this.token = token;
    this.attempt = 0;
    this.offsetMs = null;
    this.bestRtt = Infinity;
    this.anchor = null;
    this.exam = null;
    this.emit('connecting');
    void this.connect(this.generation);
  }

  private load(queue: OfflineQueue): void {
    const saves: AnswerSave[] = [];
    for (const item of queue.load()) {
      if (item.t === 'answer.save') saves.push(item);
      else if (item.t === 'event') this.pending.set(item.id, item);
      else this.pendingTranscript.set(item.key, item);
    }
    this.answers.restore(saves);
  }

  /**
   * Ends the session for good (Leave): nothing of it may reach the next exam's server, so
   * everything unacked is forgotten too (M60). A restart of the same session goes through `start`.
   */
  stop(): void {
    this.halt();
    this.pending.clear();
    this.pendingTranscript.clear();
    this.answers.clear();
    this.shownMessages.clear();
    this.exam = null;
    this.queue = null;
    this.deps.onStop?.();
  }

  private halt(): void {
    this.settleSubmit({ ok: false, reason: 'stopped' });
    // The pictures stay with the socket that would have sent them; the events go out without.
    for (const id of this.pictures.keys()) {
      const event = this.pending.get(id);
      if (event?.screenshotRef) {
        const withoutPicture: EventReport = { ...event };
        delete withoutPicture.screenshotRef;
        this.pending.set(id, withoutPicture);
      }
    }
    this.pictures.clear();
    this.pictureBytes = 0;
    this.pings.clear();
    this.generation += 1;
    this.target = null;
    this.clearTimers();
    if (this.welcomed) {
      this.deps.onThumbs?.(null);
      this.deps.onLive?.(null);
    }
    this.welcomed = null;
    this.socket?.removeAllListeners();
    this.socket?.terminate();
    this.socket = null;
  }

  /** Estimated server clock minus local clock, or `null` before the first pong. */
  get clockOffsetMs(): number | null {
    return this.offsetMs;
  }

  private emit(link: SessionStatus['link'], reason?: string): void {
    this.deps.onStatus({ link, offsetMs: this.offsetMs, ...(reason ? { reason } : {}) });
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.pingTimer = null;
    this.retryTimer = null;
  }

  private async connect(generation: number): Promise<void> {
    const target = this.target;
    if (!target) return;
    let pinned;
    try {
      pinned = await connectPinned(target);
    } catch (e) {
      if (generation !== this.generation) return;
      if (e instanceof PinError && e.code === 'fingerprint_mismatch') {
        // Retrying cannot help, so a pending Submit must not wait forever (M60).
        this.settleSubmit({ ok: false, reason: 'fingerprint_mismatch' });
        return this.emit('failed', 'fingerprint_mismatch');
      }
      return this.retry(generation);
    }
    if (generation !== this.generation) {
      pinned.socket.destroy();
      return;
    }
    const ws = new WebSocket(`wss://${target.address}:${target.port}/ws`, {
      createConnection: () => pinned.socket,
      rejectUnauthorized: false,
      maxPayload: 512 * 1024,
    });
    this.socket = ws;
    ws.on('open', () => {
      this.lastReceived = Date.now();
      this.watchTimer = setInterval(() => this.watch(ws), this.pingMs);
      ws.send(
        JSON.stringify({
          t: 'hello',
          token: this.token,
          protocol: PROTOCOL_VERSION,
          resume: { lastServerSeq: 0 },
        }),
      );
    });
    ws.on('message', (data) => this.onMessage(ws, data.toString(), generation));
    ws.on('close', (code) => this.onClosed(generation, code));
    ws.on('error', () => ws.terminate());
  }

  private onMessage(ws: WebSocket, raw: string, generation: number): void {
    if (generation !== this.generation) return;
    this.lastReceived = Date.now();
    let parsed;
    try {
      parsed = ServerToStudentSchema.safeParse(JSON.parse(raw));
    } catch {
      return;
    }
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.t === 'welcome') {
      this.attempt = 0;
      // A first clock sample at once (M64), so a PC whose clock is far off never shows a wrong
      // time until the first pong; any pong replaces it.
      if (!this.anchor) {
        const perf = this.perfNow();
        this.anchor = { server: message.serverTime, perf, takenAt: perf };
        this.offsetMs = this.serverNow() - Date.now();
      }
      this.exam = message.state;
      this.deps.onExam?.(message.state);
      this.emit('connected');
      this.pingTimer = setInterval(() => this.ping(ws), this.pingMs);
      this.ping(ws);
      this.welcomed = ws;
      if (this.monitorStatus) this.sendFrame(ws, { t: 'monitor.status', ...this.monitorStatus });
      if (this.readiness) this.sendFrame(ws, { t: 'readiness.report', ...this.readiness });
      this.answers.continueAfter(message.state.saved);
      for (const save of this.answers.unacked()) this.sendFrame(ws, save);
      for (const event of this.pending.values()) this.sendEventFrames(ws, event);
      for (const chunk of this.pendingTranscript.values()) this.sendFrame(ws, chunk);
      // After the saves on the same ordered socket, so the server sees them first.
      if (message.state.receipt) this.settleSubmit({ ok: true });
      else if (this.pendingSubmit) this.sendFrame(ws, this.pendingSubmit.frame);
    } else if (message.t === 'event.ack') {
      this.pending.delete(message.id);
      this.queue?.remove(`e${message.id}`);
      this.dropPicture(message.id);
    } else if (message.t === 'answer.ack') {
      this.answers.ack(message.clientSeq, Date.now());
      this.queue?.remove(`s${message.clientSeq}`);
    } else if (message.t === 'transcript.ack') {
      this.pendingTranscript.delete(message.key);
      this.queue?.remove(`c${message.key}`);
    } else if (message.t === 'state') {
      if (!this.exam) return;
      const wasPaused = this.exam.pausedAt != null;
      this.exam = { ...this.exam, ...message.state };
      this.deps.onExam?.(this.exam);
      if (message.state.receipt) this.settleSubmit({ ok: true });
      // A Submit the server refused during the pause goes out again once it ends (M60).
      else if (wasPaused && this.exam.pausedAt == null && this.pendingSubmit) {
        this.sendFrame(ws, this.pendingSubmit.frame);
      }
    } else if (message.t === 'submit.result') {
      if (!this.exam) return;
      this.exam = { ...this.exam, studentState: 'submitted', receipt: message.receipt };
      this.deps.onExam?.(this.exam);
      this.settleSubmit({ ok: true });
    } else if (message.t === 'submit.refused') {
      // Paused (M60): the Submit stays pending and is sent again when the exam resumes.
      if (message.reason === 'paused') return;
      this.settleSubmit({ ok: false, reason: message.reason });
    } else if (message.t === 'message') {
      this.sendFrame(ws, { t: 'ack', id: message.id });
      if (this.shownMessages.has(message.id)) return;
      this.shownMessages.add(message.id);
      if (this.shownMessages.size > 200) {
        const oldest = this.shownMessages.values().next().value;
        if (oldest !== undefined) this.shownMessages.delete(oldest);
      }
      this.deps.onTeacherMessage?.(message);
    } else if (message.t === 'thumb.start') {
      this.deps.onThumbs?.(message);
    } else if (message.t === 'thumb.stop') {
      this.deps.onThumbs?.(null);
    } else if (
      message.t === 'live.request' ||
      message.t === 'live.stop' ||
      message.t === 'rtc.signal'
    ) {
      this.deps.onLive?.(message);
    } else if (message.t === 'pong') {
      this.onPong(message.clientSent, message.serverTime);
    }
  }

  /**
   * One clock sample (M64). Round trips are measured on the monotonic clock. The sample with the
   * shortest round trip is the least distorted by queueing, but a sample older than a minute is
   * replaced anyway. The offset to the wall clock is recomputed on every pong, so a Windows time
   * sync mid-exam is followed within one ping.
   */
  private onPong(clientSent: number, serverTime: number): void {
    const sentPerf = this.pings.get(clientSent);
    if (sentPerf === undefined) return;
    this.pings.delete(clientSent);
    const perf = this.perfNow();
    const rtt = perf - sentPerf;
    const stale = !this.anchor || perf - this.anchor.takenAt > CLOCK_SAMPLE_MAX_AGE_MS;
    if (rtt >= 0 && (rtt <= this.bestRtt || stale)) {
      this.bestRtt = rtt;
      this.anchor = { server: serverTime, perf: sentPerf + rtt / 2, takenAt: perf };
    }
    const offset = this.serverNow() - Date.now();
    if (this.offsetMs === null || Math.abs(offset - this.offsetMs) >= 50) {
      this.offsetMs = offset;
      this.emit('connected');
    }
  }

  private get pingMs(): number {
    return this.deps.pingMs ?? STUDENT_PING_MS;
  }

  /** A socket that stays silent for three ping periods is dead (a pulled cable): drop it and retry. */
  private watch(ws: WebSocket): void {
    if (Date.now() - this.lastReceived > 3 * this.pingMs) ws.terminate();
  }

  private ping(ws: WebSocket): void {
    if (ws.readyState === WebSocket.OPEN) {
      const clientSent = Date.now();
      this.pings.set(clientSent, this.perfNow());
      // Unanswered pings of a dead link are not kept forever.
      if (this.pings.size > 10) this.pings.delete(this.pings.keys().next().value ?? clientSent);
      ws.send(JSON.stringify({ t: 'ping', clientSent }));
    }
  }

  private onClosed(generation: number, code: number): void {
    if (generation !== this.generation) return;
    this.clearTimers();
    this.socket = null;
    if (this.welcomed) {
      this.deps.onThumbs?.(null);
      this.deps.onLive?.(null);
    }
    this.welcomed = null;
    const final = FINAL[code];
    if (final) {
      // Retrying cannot help, so a pending Submit must not wait forever (M60).
      this.settleSubmit({ ok: false, reason: final });
      return this.emit('failed', final);
    }
    this.retry(generation);
  }

  private retry(generation: number): void {
    if (generation !== this.generation) return;
    this.emit('reconnecting');
    const delay = reconnectDelay(this.attempt, this.deps.random);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => void this.connect(generation), delay);
  }
}

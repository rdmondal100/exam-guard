import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  PROTOCOL_VERSION,
  STUDENT_PING_MS,
  ServerToStudentSchema,
  WS_CLOSE,
  type AnswerSaveRequest,
  type AnswerStatus,
  type AppEventType,
  type EventReport,
  type SessionState,
  type SessionStatus,
  type TranscriptChunk,
} from '@examguard/shared';

/** Unacked events kept in memory; the oldest are dropped past this. The disk queue is M17. */
export const MAX_PENDING_EVENTS = 500;
/** Unacked transcript chunks kept in memory (16 KB each at most). */
export const MAX_PENDING_TRANSCRIPT = 128;
import { AnswerOutbox } from './answers/answer-outbox.js';
import { PinError, connectPinned, type PinnedTarget } from './tls-pin.js';

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
  pingMs?: number;
  random?: () => number;
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
  private generation = 0;
  private exam: SessionState | null = null;
  private welcomed: WebSocket | null = null;
  /** Sent events waiting for `event.ack`, in send order. */
  private readonly pending = new Map<string, EventReport>();
  /** Sent transcript chunks waiting for `transcript.ack`, in send order. */
  private readonly pendingTranscript = new Map<string, TranscriptChunk>();

  /** Autosaves waiting for `answer.ack`, and the counter that numbers them. */
  private readonly answers: AnswerOutbox;

  constructor(private readonly deps: SessionClientDeps) {
    this.answers = new AnswerOutbox((status) => deps.onAnswers?.(status));
  }

  /** Saves one answer buffer. It is re-sent after every reconnect until the server acks it. */
  sendAnswer(request: AnswerSaveRequest): void {
    const save = this.answers.add(request, Date.now() + (this.offsetMs ?? 0));
    if (this.welcomed) this.sendFrame(this.welcomed, save);
  }

  get answerStatus(): AnswerStatus {
    return this.answers.status();
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
      clientTs: Date.now(),
      type,
      details,
    };
    this.pending.set(id, event);
    if (this.pending.size > MAX_PENDING_EVENTS) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
    if (this.welcomed) this.sendFrame(this.welcomed, event);
  }

  /** Sends a piece of the terminal transcript; re-sent after reconnects until acked. */
  sendTranscript(key: string, text: string): void {
    const chunk: TranscriptChunk = { t: 'transcript', key, clientTs: Date.now(), text };
    this.pendingTranscript.set(key, chunk);
    if (this.pendingTranscript.size > MAX_PENDING_TRANSCRIPT) {
      const oldest = this.pendingTranscript.keys().next().value;
      if (oldest !== undefined) this.pendingTranscript.delete(oldest);
    }
    if (this.welcomed) this.sendFrame(this.welcomed, chunk);
  }

  private sendFrame(ws: WebSocket, frame: object): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  }

  /** Starts (or restarts) the session. The token never leaves main. */
  start(target: PinnedTarget, token: string): void {
    this.stop();
    this.target = target;
    this.token = token;
    this.attempt = 0;
    this.offsetMs = null;
    this.bestRtt = Infinity;
    this.exam = null;
    this.emit('connecting');
    void this.connect(this.generation);
  }

  stop(): void {
    this.generation += 1;
    this.target = null;
    this.clearTimers();
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
      this.exam = message.state;
      this.deps.onExam?.(message.state);
      this.emit('connected');
      this.pingTimer = setInterval(() => this.ping(ws), this.deps.pingMs ?? STUDENT_PING_MS);
      this.ping(ws);
      this.welcomed = ws;
      this.answers.continueAfter(message.state.saved);
      for (const save of this.answers.unacked()) this.sendFrame(ws, save);
      for (const event of this.pending.values()) this.sendFrame(ws, event);
      for (const chunk of this.pendingTranscript.values()) this.sendFrame(ws, chunk);
    } else if (message.t === 'event.ack') {
      this.pending.delete(message.id);
    } else if (message.t === 'answer.ack') {
      this.answers.ack(message.clientSeq, Date.now());
    } else if (message.t === 'transcript.ack') {
      this.pendingTranscript.delete(message.key);
    } else if (message.t === 'state') {
      if (!this.exam) return;
      this.exam = { ...this.exam, ...message.state };
      this.deps.onExam?.(this.exam);
    } else if (message.t === 'pong') {
      const received = Date.now();
      const rtt = received - message.clientSent;
      // The sample with the shortest round trip is the least distorted by queueing.
      if (rtt >= 0 && rtt <= this.bestRtt) {
        this.bestRtt = rtt;
        this.offsetMs = Math.round(message.serverTime - (message.clientSent + rtt / 2));
        this.emit('connected');
      }
    }
  }

  private ping(ws: WebSocket): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'ping', clientSent: Date.now() }));
    }
  }

  private onClosed(generation: number, code: number): void {
    if (generation !== this.generation) return;
    this.clearTimers();
    this.socket = null;
    this.welcomed = null;
    const final = FINAL[code];
    if (final) return this.emit('failed', final);
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

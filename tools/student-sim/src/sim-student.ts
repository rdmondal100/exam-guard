import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, STUDENT_PING_MS, WS_CLOSE, type Receipt } from '@examguard/shared';
import { agent, postJson, type Target } from './http.js';
import { receiptProblem } from './sim-receipt.js';
import { SimSaves, type SaveStats } from './sim-saves.js';

export type SimState = 'joining' | 'connecting' | 'connected' | 'failed';

export interface SimStudentOptions {
  target: Target;
  pin: string;
  code: string;
  onState: (code: string, state: SimState, detail?: string) => void;
  pingMs?: number;
  /** Save an answer this often once the exam runs (0 or missing = never). */
  autosaveMs?: number;
  /** Submit this long after the exam's questions arrive (0 or missing = wait for the auto-submit). */
  submitAfterMs?: number;
  /** Drop the socket about this often (0 or missing = never); the student reconnects. */
  disconnectEveryMs?: number;
}

export interface SubmitStats {
  /** Holds a receipt (submitted, auto-submitted or ended by the teacher). */
  receipt: boolean;
  /** The student pressed Submit itself. */
  selfSubmitted: boolean;
  problems: string[];
  disconnects: number;
  refused: number;
}

/** Closes after which the server will not take this session back. */
const FINAL_CLOSES: number[] = [
  WS_CLOSE.unauthorized,
  WS_CLOSE.protocolMismatch,
  WS_CLOSE.replaced,
];

const retryDelay = (attempt: number) =>
  Math.round(Math.min(5000, 500 * 2 ** attempt) * (0.5 + Math.random() * 0.5));

/** One fake student: join, accept the notice, hold the lobby socket, reconnect when it drops. */
export class SimStudent {
  private token = '';
  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private stopped = false;
  private readonly deviceId = `sim-${randomBytes(8).toString('hex')}`;
  private readonly saves: SimSaves | null;
  private receipt: Receipt | null = null;
  private submitting = false;
  private submitTimer: NodeJS.Timeout | null = null;
  private dropTimer: NodeJS.Timeout | null = null;
  private readonly submitId = `sim-submit-${randomBytes(6).toString('hex')}`;
  private readonly problems: string[] = [];
  private disconnects = 0;
  private refused = 0;

  constructor(private readonly options: SimStudentOptions) {
    this.saves = options.autosaveMs ? new SimSaves(options.autosaveMs, options.code) : null;
  }

  saveStats(): SaveStats {
    return this.saves?.stats() ?? { sent: 0, acked: 0, pending: 0 };
  }

  submitStats(): SubmitStats {
    return {
      receipt: this.receipt !== null,
      selfSubmitted: this.submitting && this.receipt !== null,
      problems: this.problems,
      disconnects: this.disconnects,
      refused: this.refused,
    };
  }

  async start(): Promise<void> {
    const { code, onState, target, pin } = this.options;
    onState(code, 'joining');
    try {
      const joined = await postJson(target, '/join', {
        studentCode: code,
        pin,
        deviceId: this.deviceId,
        protocol: PROTOCOL_VERSION,
        agent: { ok: true, helper: true, captureOk: true, monitors: 1 },
      });
      const token = (joined.json as { token?: unknown } | null)?.token;
      if (joined.status !== 200 || typeof token !== 'string') {
        const error = (joined.json as { error?: { code?: string } } | null)?.error?.code;
        return onState(code, 'failed', `join ${joined.status} ${error ?? ''}`.trim());
      }
      this.token = token;
      const confirmed = await postJson(target, '/join/confirm', { noticeAccepted: true }, token);
      if (confirmed.status !== 200) return onState(code, 'failed', `confirm ${confirmed.status}`);
    } catch (e) {
      return onState(code, 'failed', e instanceof Error ? e.message : String(e));
    }
    if (!this.stopped) this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.pingTimer = this.retryTimer = null;
    if (this.submitTimer) clearTimeout(this.submitTimer);
    if (this.dropTimer) clearTimeout(this.dropTimer);
    this.submitTimer = this.dropTimer = null;
    this.saves?.detach();
    this.ws?.removeAllListeners();
    this.ws?.terminate();
    this.ws = null;
  }

  private connect(): void {
    const { code, onState, target } = this.options;
    onState(code, 'connecting');
    const ws = new WebSocket(`wss://${target.host}:${target.port}/ws`, {
      agent,
      rejectUnauthorized: false,
    });
    this.ws = ws;
    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          t: 'hello',
          token: this.token,
          protocol: PROTOCOL_VERSION,
          resume: { lastServerSeq: 0 },
        }),
      ),
    );
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as {
        t?: string;
        clientSeq?: number;
        state?: { questions?: unknown; saved?: unknown; receipt?: Receipt | null };
        receipt?: Receipt;
      };
      if (message.t === 'answer.ack' && message.clientSeq !== undefined) {
        return this.saves?.ack(message.clientSeq);
      }
      if (message.t === 'submit.result' && message.receipt) return this.gotReceipt(message.receipt);
      if (message.t === 'submit.refused') {
        this.refused += 1;
        return;
      }
      if (message.t === 'state') {
        if (message.state?.receipt) return this.gotReceipt(message.state.receipt);
        // The Start push brings the questions to a student who was waiting in the lobby.
        const first = this.saves?.setQuestions(message.state?.questions, message.state?.saved);
        if (first && this.saves) {
          this.saves.attach(ws);
          this.scheduleSubmit();
        }
        return;
      }
      if (message.t !== 'welcome') return;
      this.attempt = 0;
      onState(code, 'connected');
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: 'ping', clientSent: Date.now() }));
        }
      }, this.options.pingMs ?? STUDENT_PING_MS);
      if (message.state?.receipt) return this.gotReceipt(message.state.receipt);
      if (this.saves?.setQuestions(message.state?.questions, message.state?.saved)) {
        this.scheduleSubmit();
      }
      this.saves?.attach(ws);
      // After the unacked saves on the same socket, as the real app does.
      if (this.submitting) this.sendSubmit(ws);
      this.scheduleDrop(ws);
    });
    ws.on('close', (closeCode) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.saves?.detach();
      if (this.dropTimer) clearTimeout(this.dropTimer);
      this.dropTimer = null;
      if (this.stopped || this.receipt) return;
      if (FINAL_CLOSES.includes(closeCode)) return onState(code, 'failed', `closed ${closeCode}`);
      onState(code, 'connecting', `closed ${closeCode}`);
      this.retryTimer = setTimeout(() => this.connect(), retryDelay(this.attempt++));
    });
    ws.on('error', () => ws.terminate());
  }

  private scheduleSubmit(): void {
    const after = this.options.submitAfterMs ?? 0;
    if (after <= 0 || this.submitTimer || this.receipt) return;
    this.submitTimer = setTimeout(
      () => {
        this.submitting = true;
        this.saves?.freeze();
        if (this.ws) this.sendSubmit(this.ws);
      },
      after * (0.8 + Math.random() * 0.4),
    );
  }

  private sendSubmit(ws: WebSocket): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'submit', id: this.submitId, clientTs: Date.now() }));
    }
  }

  private scheduleDrop(ws: WebSocket): void {
    const every = this.options.disconnectEveryMs ?? 0;
    if (every <= 0 || this.receipt) return;
    this.dropTimer = setTimeout(
      () => {
        this.disconnects += 1;
        ws.terminate();
      },
      every * (0.5 + Math.random()),
    );
  }

  private gotReceipt(receipt: Receipt): void {
    if (this.receipt) return;
    this.receipt = receipt;
    this.saves?.freeze();
    // What the student wrote is only known for sure when it submitted itself: after that no
    // save is made, and the unacked ones are re-sent before the submit.
    const expected = this.submitting ? (this.saves?.expectedAnswers() ?? null) : null;
    const problem = receiptProblem(receipt, expected);
    if (problem) this.problems.push(problem);
    if (this.dropTimer) clearTimeout(this.dropTimer);
    this.dropTimer = null;
  }
}

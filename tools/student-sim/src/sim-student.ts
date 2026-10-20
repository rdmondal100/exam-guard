import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, STUDENT_PING_MS, WS_CLOSE } from '@examguard/shared';
import { agent, postJson, type Target } from './http.js';

export type SimState = 'joining' | 'connecting' | 'connected' | 'failed';

export interface SimStudentOptions {
  target: Target;
  pin: string;
  code: string;
  onState: (code: string, state: SimState, detail?: string) => void;
  pingMs?: number;
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

  constructor(private readonly options: SimStudentOptions) {}

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
      const message = JSON.parse(data.toString()) as { t?: string };
      if (message.t !== 'welcome') return;
      this.attempt = 0;
      onState(code, 'connected');
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: 'ping', clientSent: Date.now() }));
        }
      }, this.options.pingMs ?? STUDENT_PING_MS);
    });
    ws.on('close', (closeCode) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.stopped) return;
      if (FINAL_CLOSES.includes(closeCode)) return onState(code, 'failed', `closed ${closeCode}`);
      onState(code, 'connecting', `closed ${closeCode}`);
      this.retryTimer = setTimeout(() => this.connect(), retryDelay(this.attempt++));
    });
    ws.on('error', () => ws.terminate());
  }
}

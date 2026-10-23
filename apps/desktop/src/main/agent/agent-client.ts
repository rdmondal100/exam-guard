import type { Socket } from 'node:net';
import {
  AgentToAppSchema,
  HEARTBEAT_LOST_MS,
  PIPE_VERSION,
  type AgentLinkStatus,
  type AgentToApp,
  type PipeSystemCheckResult,
} from '@examguard/shared';
import { NOT_RUNNING, unlinked, type AgentLink } from './agent-link.js';
import { encodeFrame, FrameDecoder } from './pipe-frames.js';

export interface AgentClientOptions {
  /** Opens the pipe (`net.connect(AGENT_PIPE_NAME)`); a test hands in its own server's socket. */
  connect: () => Socket;
  /** Whether the process id the agent named is really the installed agent service. */
  verifyService: (pid: number) => Promise<boolean>;
  appVersion: string;
  /** No heartbeat for this long and the link counts as lost. */
  lostAfterMs?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  /** How long a system check may take before it counts as failed. */
  checkTimeoutMs?: number;
  /** A fresh system check this often while linked, so the status never goes stale. */
  recheckMs?: number;
  log?: (text: string) => void;
}

interface CheckOutcome {
  ok: boolean;
  captureOk: boolean;
  monitors: number;
  problems: string[];
}

const UNVERIFIED = 'This is not the ExamGuard monitoring agent.';
const LOST = 'The monitoring agent stopped answering.';
const CHECKING = 'Checking the monitoring agent…';
const NO_ANSWER = 'The monitoring agent did not answer the system check.';
const NO_HELPER = 'The monitoring helper is not running.';

/**
 * Pipe client of the student app. It connects to the agent, proves the other end is the installed
 * service, answers every heartbeat, and keeps the result of the latest system check. When the pipe
 * breaks or goes quiet it reconnects by itself. Locking the exam on a lost link is M24.
 */
export class AgentClient implements AgentLink {
  private socket: Socket | null = null;
  private decoder = new FrameDecoder();
  private running = false;
  private verified = false;
  private helper = false;
  private lastBeat = 0;
  private lastCheck: CheckOutcome | null = null;
  private why: string | null = null;
  private seq = 0;
  private pending = new Map<number, (result: PipeSystemCheckResult | null) => void>();
  private listeners = new Set<(status: AgentLinkStatus) => void>();
  private lastEmitted = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private recheck: NodeJS.Timeout | null = null;
  private backoffMs: number;

  private readonly lostAfterMs: number;
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly checkTimeoutMs: number;
  private readonly recheckMs: number;

  constructor(private readonly options: AgentClientOptions) {
    this.lostAfterMs = options.lostAfterMs ?? HEARTBEAT_LOST_MS;
    this.minMs = options.reconnectMinMs ?? 500;
    this.maxMs = options.reconnectMaxMs ?? 3000;
    this.checkTimeoutMs = options.checkTimeoutMs ?? 5000;
    this.recheckMs = options.recheckMs ?? 10_000;
    this.backoffMs = this.minMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.watchdog = setInterval(() => this.watch(), 500);
    this.open();
  }

  stop(): void {
    this.running = false;
    for (const timer of [this.reconnectTimer, this.watchdog, this.recheck]) {
      if (timer) clearTimeout(timer);
    }
    this.reconnectTimer = this.watchdog = this.recheck = null;
    this.socket?.destroy();
  }

  status(): AgentLinkStatus {
    if (!this.verified) return unlinked(this.why ?? NOT_RUNNING);
    if (!this.helper) return { ...unlinked(NO_HELPER), verified: true };
    const check = this.lastCheck;
    if (!check) return { ...unlinked(CHECKING), verified: true, helper: true };
    return {
      verified: true,
      ok: check.ok,
      helper: true,
      captureOk: check.captureOk,
      monitors: check.monitors,
      problems: check.problems,
    };
  }

  onChange(listener: (status: AgentLinkStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async check(): Promise<AgentLinkStatus> {
    if (!this.verified || !this.socket) return this.status();
    const seq = this.nextSeq();
    const result = await new Promise<PipeSystemCheckResult | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        resolve(null);
      }, this.checkTimeoutMs);
      this.pending.set(seq, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      this.send({ t: 'system.check', seq });
    });
    this.lastCheck = result
      ? {
          ok: result.ok,
          captureOk: result.captureOk,
          monitors: result.monitors,
          problems: result.problems,
        }
      : { ok: false, captureOk: false, monitors: 0, problems: [NO_ANSWER] };
    if (result) this.helper = result.helper;
    this.emit();
    return this.status();
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private open(): void {
    if (!this.running) return;
    const socket = this.options.connect();
    this.socket = socket;
    this.decoder = new FrameDecoder();
    socket.on('connect', () => {
      this.send({
        t: 'hello',
        seq: this.nextSeq(),
        pipeVersion: PIPE_VERSION,
        appVersion: this.options.appVersion,
      });
    });
    socket.on('data', (chunk: Buffer) => this.onData(socket, chunk));
    socket.on('error', () => undefined); // the 'close' event follows
    socket.on('close', () => this.onClose(socket));
  }

  private onData(socket: Socket, chunk: Buffer): void {
    let messages: unknown[];
    try {
      messages = this.decoder.push(chunk);
    } catch {
      socket.destroy();
      return;
    }
    for (const raw of messages) {
      const parsed = AgentToAppSchema.safeParse(raw);
      if (parsed.success) void this.onMessage(socket, parsed.data);
    }
  }

  private async onMessage(socket: Socket, message: AgentToApp): Promise<void> {
    if (message.t === 'hello') {
      if (this.verified) return;
      const genuine = await this.options.verifyService(message.pid).catch(() => false);
      if (socket !== this.socket) return;
      if (!genuine) {
        this.why = UNVERIFIED;
        this.options.log?.('agent hello refused: pid does not belong to the installed service');
        socket.destroy();
        return;
      }
      this.verified = true;
      this.helper = message.helper;
      this.lastBeat = Date.now();
      this.why = null;
      this.backoffMs = this.minMs;
      this.recheck = setInterval(() => void this.check(), this.recheckMs);
      this.emit();
      void this.check();
      return;
    }
    if (!this.verified) return;
    if (message.t === 'heartbeat') {
      this.lastBeat = Date.now();
      this.send({ t: 'heartbeat.ack', seq: this.nextSeq(), hbSeq: message.hbSeq });
      if (message.helper !== this.helper) {
        this.helper = message.helper;
        this.emit();
        if (message.helper) void this.check();
      }
    } else if (message.t === 'system.check.result') {
      this.pending.get(message.reqSeq)?.(message);
      this.pending.delete(message.reqSeq);
    }
  }

  private send(message: unknown): void {
    if (this.socket && !this.socket.destroyed) this.socket.write(encodeFrame(message));
  }

  /** Called twice a second: a verified link that has gone quiet is dropped and reopened. */
  private watch(): void {
    if (!this.verified || Date.now() - this.lastBeat <= this.lostAfterMs) return;
    this.why = LOST;
    this.options.log?.('no heartbeat from the agent; dropping the link');
    this.socket?.destroy();
  }

  private onClose(socket: Socket): void {
    if (socket !== this.socket) return;
    this.socket = null;
    if (this.recheck) clearInterval(this.recheck);
    this.recheck = null;
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
    this.verified = false;
    this.helper = false;
    this.lastCheck = null;
    this.emit();
    if (!this.running) return;
    this.reconnectTimer = setTimeout(() => this.open(), this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxMs);
  }

  private emit(): void {
    const status = this.status();
    const key = JSON.stringify(status);
    if (key === this.lastEmitted) return;
    this.lastEmitted = key;
    for (const listener of this.listeners) listener(status);
  }
}

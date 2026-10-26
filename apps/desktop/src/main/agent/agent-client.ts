import type { Socket } from 'node:net';
import {
  AgentToAppSchema,
  HEARTBEAT_LOST_MS,
  PIPE_VERSION,
  type AgentLinkStatus,
  type AgentToApp,
  type PipeSystemCheckResult,
} from '@examguard/shared';
import {
  NOT_RUNNING,
  unlinked,
  type AgentEvidence,
  type AgentLink,
  type InternetOutcome,
  type MonitoringRequest,
} from './agent-link.js';
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
  private wantedNet: { blocked: boolean; allow: string[] } | null = null;
  private netOutcome: InternetOutcome = { blocked: false, error: null };
  private netListeners = new Set<(outcome: InternetOutcome) => void>();
  private wantedMonitor: MonitoringRequest | null = null;
  /** A `monitor.stop` is owed: the app stopped while the link was down. */
  private stopPending = false;
  private examWindow: { hwnd: number; pid: number } | null = null;
  private evidenceListeners = new Set<(evidence: AgentEvidence) => void>();
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

  setInternet(blocked: boolean, allow: string[]): void {
    this.wantedNet = { blocked, allow };
    if (this.verified) this.sendNet();
    else if (blocked) {
      this.setNetOutcome({ blocked: false, error: this.status().problems[0] ?? NOT_RUNNING });
    } else this.setNetOutcome({ blocked: false, error: null });
  }

  internet(): InternetOutcome {
    return this.netOutcome;
  }

  onInternet(listener: (outcome: InternetOutcome) => void): () => void {
    this.netListeners.add(listener);
    return () => this.netListeners.delete(listener);
  }

  setMonitoring(request: MonitoringRequest | null): void {
    const previous = this.wantedMonitor;
    this.wantedMonitor = request;
    if (request) this.stopPending = false;
    else if (previous) this.stopPending = true;
    if (this.verified) this.sendMonitor();
  }

  setExamWindow(hwnd: number, pid: number): void {
    this.examWindow = { hwnd, pid };
    if (this.verified) this.sendWindow();
  }

  onEvidence(listener: (evidence: AgentEvidence) => void): () => void {
    this.evidenceListeners.add(listener);
    return () => this.evidenceListeners.delete(listener);
  }

  ackEvidence(upTo: number): void {
    if (this.verified) this.send({ t: 'evidence.ack', seq: this.nextSeq(), upTo });
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
      if (this.wantedNet) this.sendNet();
      this.sendWindow();
      this.sendMonitor();
      this.emit();
      void this.check();
      return;
    }
    if (!this.verified) return;
    if (message.t === 'heartbeat') {
      this.lastBeat = Date.now();
      this.send({ t: 'heartbeat.ack', seq: this.nextSeq(), hbSeq: message.hbSeq });
      // The lease: the agent lifts the block when these stop coming.
      if (this.wantedNet?.blocked) this.sendNet();
      // A service that restarted its helper side may have lost the request; saying it again is harmless.
      if (this.wantedMonitor && !message.monitoring) this.sendMonitor();
      if (message.helper !== this.helper) {
        this.helper = message.helper;
        this.emit();
        if (message.helper) void this.check();
      }
    } else if (message.t === 'net.status') {
      this.setNetOutcome({ blocked: message.blocked, error: message.error });
    } else if (message.t === 'evidence') {
      const evidence: AgentEvidence = {
        evidenceSeq: message.evidenceSeq,
        ts: message.ts,
        kind: message.kind,
        data: message.data,
        ...(message.screenshot ? { screenshot: message.screenshot } : {}),
      };
      for (const listener of this.evidenceListeners) listener(evidence);
    } else if (message.t === 'system.check.result') {
      this.pending.get(message.reqSeq)?.(message);
      this.pending.delete(message.reqSeq);
    }
  }

  private sendNet(): void {
    if (!this.wantedNet) return;
    const { blocked, allow } = this.wantedNet;
    this.send({ t: 'net.set', seq: this.nextSeq(), blocked, allow });
  }

  private sendWindow(): void {
    if (!this.examWindow) return;
    const { hwnd, pid } = this.examWindow;
    this.send({ t: 'exam.window', seq: this.nextSeq(), hwnd, pid });
  }

  /** Tells the agent to monitor, or (once) to stop when the app stopped while the link was down. */
  private sendMonitor(): void {
    if (this.wantedMonitor) {
      const { examStudentId, policy } = this.wantedMonitor;
      this.send({ t: 'monitor.start', seq: this.nextSeq(), examStudentId, policy });
    } else if (this.stopPending) {
      this.send({ t: 'monitor.stop', seq: this.nextSeq() });
      this.stopPending = false;
    }
  }

  private setNetOutcome(outcome: InternetOutcome): void {
    const same =
      outcome.blocked === this.netOutcome.blocked && outcome.error === this.netOutcome.error;
    if (same) return;
    this.netOutcome = outcome;
    for (const listener of this.netListeners) listener(outcome);
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
    // The agent lifts the block by itself when its lease runs out, so a lost link is "not confirmed".
    if (this.wantedNet?.blocked) this.setNetOutcome({ blocked: false, error: LOST });
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

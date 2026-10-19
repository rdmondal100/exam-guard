import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { powerSaveBlocker, utilityProcess, type UtilityProcess } from 'electron';
import {
  ServerReplyMessageSchema,
  TEACHER_API_HOST,
  TEACHER_API_PORT,
  type ServerConnection,
  type ServerStatus,
} from '@examguard/shared';
import { STABLE_UPTIME_MS, restartDelayMs } from './server-backoff.js';

/** Runs the exam server in a utilityProcess and restarts it when it exits. */
export class ServerHost {
  private child: UtilityProcess | null = null;
  private token = '';
  private startedAt = 0;
  private failures = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;
  private log: WriteStream | null = null;
  private sleepBlockerId: number | null = null;
  private status: ServerStatus = { state: 'stopped', restartCount: 0, lastRestartAt: null };

  constructor(
    private readonly dataDir: string,
    private readonly logDir: string,
    private readonly onStatus: (status: ServerStatus) => void,
  ) {}

  getStatus(): ServerStatus {
    return this.status;
  }

  getConnection(): ServerConnection | null {
    if (!this.token) return null;
    return { baseUrl: `http://${TEACHER_API_HOST}:${TEACHER_API_PORT}`, token: this.token };
  }

  start(): void {
    if (this.child || this.timer) return;
    this.stopping = false;
    mkdirSync(this.logDir, { recursive: true });
    this.log ??= createWriteStream(join(this.logDir, 'server.log'), { flags: 'a' });
    this.spawn('starting');
  }

  stop(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.child?.kill();
    this.child = null;
    this.setSleepBlocked(false);
    this.log?.end();
    this.log = null;
    this.setStatus({ state: 'stopped' });
  }

  private spawn(state: 'starting' | 'restarting'): void {
    // A new token per process: the old one dies with the old server.
    this.token = randomBytes(32).toString('hex');
    this.setStatus({ state });
    const entry = fileURLToPath(import.meta.resolve('@examguard/server'));
    const child = utilityProcess.fork(entry, [], {
      serviceName: 'ExamGuard server',
      stdio: 'pipe',
    });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => this.write('out', chunk));
    child.stderr?.on('data', (chunk: Buffer) => this.write('err', chunk));
    child.on('message', (raw: unknown) => this.onMessage(raw));
    child.on('exit', (code) => this.onExit(child, code));
    child.postMessage({ type: 'config', token: this.token, dataDir: this.dataDir });
  }

  private onMessage(raw: unknown): void {
    const parsed = ServerReplyMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    if (parsed.data.type === 'ready') {
      this.startedAt = Date.now();
      this.setStatus({ state: 'running' });
    } else if (parsed.data.type === 'hosting') {
      this.setSleepBlocked(parsed.data.active);
    } else {
      this.write('err', Buffer.from(`start error: ${parsed.data.message}\n`));
    }
  }

  private onExit(child: UtilityProcess, code: number): void {
    if (this.child !== child) return;
    this.child = null;
    // The listener died with the process; the restarted server reports again if it resumes.
    this.setSleepBlocked(false);
    if (this.stopping) return;
    const upFor = this.startedAt ? Date.now() - this.startedAt : 0;
    this.failures = upFor >= STABLE_UPTIME_MS ? 1 : this.failures + 1;
    this.startedAt = 0;
    const delay = restartDelayMs(this.failures - 1);
    this.write('err', Buffer.from(`server exited with code ${code}, restarting in ${delay} ms\n`));
    this.setStatus({
      state: 'restarting',
      restartCount: this.status.restartCount + 1,
      lastRestartAt: Date.now(),
    });
    this.timer = setTimeout(() => {
      this.timer = null;
      this.spawn('restarting');
    }, delay);
  }

  /** No sleep while the student listener is open (docs/architecture.md §1). */
  private setSleepBlocked(blocked: boolean): void {
    if (blocked && this.sleepBlockerId === null) {
      this.sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    } else if (!blocked && this.sleepBlockerId !== null) {
      powerSaveBlocker.stop(this.sleepBlockerId);
      this.sleepBlockerId = null;
    }
  }

  private write(stream: 'out' | 'err', chunk: Buffer): void {
    this.log?.write(`${new Date().toISOString()} [${stream}] ${chunk.toString()}`);
  }

  private setStatus(patch: Partial<ServerStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }
}

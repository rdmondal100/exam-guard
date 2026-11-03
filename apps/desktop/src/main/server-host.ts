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
import { fakeGraderEnabled } from './grading-key.js';
import { STABLE_UPTIME_MS, restartDelayMs } from './server-backoff.js';

/** The answer to `releaseData` (M44). */
export type ReleaseReply = { ok: true } | { ok: false; message: string };

const RELEASE_TIMEOUT_MS = 15_000;
const EXIT_TIMEOUT_MS = 5_000;

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
  private nextRequestId = 1;
  private readonly releases = new Map<number, (reply: ReleaseReply) => void>();
  private readonly statusWaiters = new Set<(status: ServerStatus) => void>();

  constructor(
    /** The data folder (M44: it can move, so it is read at each start). */
    private readonly dataDir: () => string,
    private readonly onStatus: (status: ServerStatus) => void,
    /** The AI key for a grading run (Settings, M43); read only when the server asks. */
    private readonly gradingKey: () => string | null = () => null,
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
    const logDir = join(this.dataDir(), 'logs');
    mkdirSync(logDir, { recursive: true });
    this.log ??= createWriteStream(join(logDir, 'server.log'), { flags: 'a' });
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

  /**
   * Stops the server and resolves once the process is gone and the log is closed, so its files
   * can be copied or deleted (M44).
   */
  async stopAndWait(): Promise<void> {
    const child = this.child;
    const log = this.log;
    const exited = child
      ? new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, EXIT_TIMEOUT_MS);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        })
      : Promise.resolve();
    const closed = log
      ? new Promise<void>((resolve) => log.once('close', () => resolve()))
      : Promise.resolve();
    this.stop();
    await Promise.all([exited, closed]);
  }

  /**
   * Before a data folder move (M44): the server closes its database unless an exam is hosting or
   * running or grading is busy. After `ok` only `stopAndWait` is left to do.
   */
  releaseData(): Promise<ReleaseReply> {
    const child = this.child;
    if (!child || this.status.state !== 'running') {
      return Promise.resolve({ ok: false, message: 'Wait until the exam server is running.' });
    }
    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.releases.delete(requestId);
        resolve({ ok: false, message: 'The exam server did not answer.' });
      }, RELEASE_TIMEOUT_MS);
      this.releases.set(requestId, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      child.postMessage({ type: 'release-data', requestId });
    });
  }

  /** `true` once the server reports `running`; `false` if it is stopped or the time runs out. */
  whenRunning(timeoutMs: number): Promise<boolean> {
    if (this.status.state === 'running') return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer);
        this.statusWaiters.delete(waiter);
        resolve(ok);
      };
      const waiter = (status: ServerStatus) => {
        if (status.state === 'running') done(true);
        else if (status.state === 'stopped') done(false);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      this.statusWaiters.add(waiter);
    });
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
    child.postMessage({
      type: 'config',
      token: this.token,
      dataDir: this.dataDir(),
      fakeGrader: fakeGraderEnabled(),
    });
  }

  private onMessage(raw: unknown): void {
    const parsed = ServerReplyMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    if (parsed.data.type === 'ready') {
      this.startedAt = Date.now();
      this.setStatus({ state: 'running' });
    } else if (parsed.data.type === 'hosting') {
      this.setSleepBlocked(parsed.data.active);
    } else if (parsed.data.type === 'data-released') {
      const { requestId, ok, message } = parsed.data;
      this.releases.get(requestId)?.(
        ok ? { ok: true } : { ok: false, message: message ?? 'The data is in use.' },
      );
      this.releases.delete(requestId);
    } else if (parsed.data.type === 'grading-key-request') {
      // The key goes over the process port only, never through the renderer (architecture §7).
      this.child?.postMessage({
        type: 'grading-key',
        requestId: parsed.data.requestId,
        apiKey: this.gradingKey(),
      });
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
    for (const waiter of [...this.statusWaiters]) waiter(this.status);
  }
}

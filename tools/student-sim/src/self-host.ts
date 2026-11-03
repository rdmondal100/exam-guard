import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { LoadHostReplySchema, type LoadHostCommand, type LoadHostReply } from '@examguard/shared';

export type HostReady = Extract<LoadHostReply, { type: 'ready' }>;
export type HostStats = Extract<LoadHostReply, { type: 'stats' }>;

interface Waiter {
  resolve: (reply: LoadHostReply) => void;
  reject: (error: Error) => void;
}

/**
 * The exam server of a self-hosted load test (M47): `apps/server`'s `load-host` script forked
 * into its own Node process, so its CPU and memory are its own and not the sim's.
 */
export class SelfHost {
  /** One request per answer type at a time. */
  private readonly waiting = new Map<string, Waiter>();

  private constructor(private readonly child: ChildProcess) {
    child.on('message', (raw: unknown) => {
      const parsed = LoadHostReplySchema.safeParse(raw);
      if (!parsed.success) return;
      const reply = parsed.data;
      if (reply.type === 'error') return this.failAll(new Error(`load host: ${reply.message}`));
      this.waiting.get(reply.type)?.resolve(reply);
      this.waiting.delete(reply.type);
    });
    child.on('exit', (code) => this.failAll(new Error(`load host exited (${code})`)));
  }

  static async start(
    students: number,
    minutes: number,
  ): Promise<{ host: SelfHost; ready: HostReady }> {
    const script = createRequire(import.meta.url).resolve(
      '@examguard/server/dist/scripts/load-host.js',
    );
    const child = fork(script, ['--students', String(students), '--minutes', String(minutes)], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const host = new SelfHost(child);
    const ready = await host.request<HostReady>('ready', null);
    return { host, ready };
  }

  async begin(): Promise<void> {
    await this.request('started', { type: 'start' });
  }

  stats(): Promise<HostStats> {
    return this.request<HostStats>('stats', { type: 'stats' });
  }

  async end(): Promise<void> {
    await this.request('ended', { type: 'end' });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.child.exitCode !== null || !this.child.connected) return resolve();
      this.child.once('exit', () => resolve());
      this.child.send({ type: 'close' } satisfies LoadHostCommand);
    });
  }

  private failAll(error: Error): void {
    for (const waiter of this.waiting.values()) waiter.reject(error);
    this.waiting.clear();
  }

  private request<T extends LoadHostReply>(
    answer: LoadHostReply['type'],
    command: LoadHostCommand | null,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.waiting.set(answer, { resolve: (reply) => resolve(reply as T), reject });
      if (command) this.child.send(command);
    });
  }
}

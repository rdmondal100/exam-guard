import { TERMINAL_LIMITS, type TerminalExit, type TerminalSize } from '@examguard/shared';
import type { TerminalLaunch } from './terminal-launch.js';

/** The part of a node-pty process the host uses (a fake in tests). */
export interface PtyProcess {
  onData(listener: (data: string) => void): void;
  onExit(listener: (exitCode: number) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type PtySpawn = (launch: TerminalLaunch, size: TerminalSize) => PtyProcess;

export interface TerminalHostDeps {
  spawn: PtySpawn;
  onData: (data: string) => void;
  onExit: (exit: TerminalExit) => void;
  flushMs?: number;
}

/**
 * The one exam terminal of this student (student main). Output is batched before it goes to the
 * renderer. `close()` kills the pty, which ends eg-runner, and its Job Object takes every
 * process the student started with it.
 */
export class TerminalHost {
  private pty: PtyProcess | null = null;
  private closing = false;
  private pending = '';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: TerminalHostDeps) {}

  get isOpen(): boolean {
    return this.pty !== null;
  }

  /** Starts the shell, or only resizes it when one is already open (e.g. after a reload). */
  open(launch: () => TerminalLaunch, size: TerminalSize): void {
    if (this.pty) {
      this.pty.resize(size.cols, size.rows);
      return;
    }
    const pty = this.deps.spawn(launch(), size);
    this.pty = pty;
    this.closing = false;
    pty.onData((data) => this.buffer(data));
    pty.onExit((exitCode) => {
      if (this.pty !== pty) return;
      this.flush();
      this.pty = null;
      this.deps.onExit({ exitCode, reason: this.closing ? 'closed' : 'exited' });
    });
  }

  write(data: string): void {
    this.pty?.write(data);
  }

  resize(size: TerminalSize): void {
    this.pty?.resize(size.cols, size.rows);
  }

  /** Kills the shell and everything it started. Safe to call when nothing is open. */
  close(): void {
    if (!this.pty) return;
    this.closing = true;
    this.pty.kill();
  }

  private buffer(data: string): void {
    this.pending += data;
    this.timer ??= setTimeout(() => this.flush(), this.deps.flushMs ?? TERMINAL_LIMITS.flushMs);
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return;
    const data = this.pending;
    this.pending = '';
    this.deps.onData(data);
  }
}

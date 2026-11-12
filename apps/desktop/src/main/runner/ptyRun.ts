import type { PtyProcess } from '../terminal/terminalHost.js';
import type { PtyOpen } from '../terminal/pty.js';
import { killTree as defaultKillTree, type KillTree } from './killTree.js';
import type { LimitedResult } from './spawnLimited.js';

export interface PtyRunSpawn {
  /** The student's program itself (or the interpreter that runs it, or cmd.exe hosting it). */
  command: string;
  /** Arguments, or one command line already quoted (`cmdHost.ts`). */
  args: string[] | string;
  cwd: string;
  env: Record<string, string>;
  /** Output (as the console shows it) past this many bytes ends the run. */
  outputCap: number;
  /** Wall time; past it the program's process tree is killed. */
  timeMs: number;
  size: { cols: number; rows: number };
  /** The program started (its pid) and ended (`null`). */
  onProcess?: (pid: number | null) => void;
  killTree?: KillTree;
}

export interface PtyRunHandle {
  done: Promise<LimitedResult>;
  stop(): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

const startFailure = (error: string): LimitedResult => ({
  reason: 'failed',
  exitCode: null,
  timeMs: null,
  stdout: '',
  stderr: '',
  error,
});

/**
 * Runs one program in a pseudo-console, so prompts show at once and the student types into it
 * (the interactive mode). This module does the time limit, the output cap and Stop; each of them
 * kills the program's whole process tree. Everything the program printed (stdout and stderr are
 * one stream in a console) is returned as `stdout`, capped.
 */
export function ptyRun(
  s: PtyRunSpawn,
  open: PtyOpen,
  onData: (data: string) => void,
): PtyRunHandle {
  const started = Date.now();
  let pty: PtyProcess | null = null;
  let startError: string | null = null;
  try {
    pty = open({ file: s.command, args: s.args, cwd: s.cwd, env: s.env }, s.size);
  } catch (e) {
    startError = e instanceof Error ? e.message : 'The console could not start.';
  }
  if (pty) s.onProcess?.(pty.pid);
  const chunks: Buffer[] = [];
  let bytes = 0;
  let killedFor: 'output_limit' | 'stopped' | 'time_limit' | null = null;
  const kill = (why: 'output_limit' | 'stopped' | 'time_limit') => {
    if (killedFor || !pty) return;
    killedFor = why;
    (s.killTree ?? defaultKillTree)(pty.pid);
    pty.kill();
  };
  const timer = pty ? setTimeout(() => kill('time_limit'), s.timeMs) : null;

  const done = new Promise<LimitedResult>((resolve) => {
    const p = pty;
    if (!p) return resolve(startFailure(startError ?? 'The console could not start.'));
    p.onData((data) => {
      if (killedFor) return;
      const chunk = Buffer.from(data, 'utf8');
      const room = s.outputCap - bytes;
      if (chunk.length > room) {
        const kept = chunk.subarray(0, Math.max(0, room));
        if (kept.length > 0) {
          chunks.push(kept);
          onData(kept.toString('utf8'));
        }
        bytes = s.outputCap;
        kill('output_limit');
        return;
      }
      chunks.push(chunk);
      bytes += chunk.length;
      onData(data);
    });
    p.onExit((exitCode) => {
      if (timer) clearTimeout(timer);
      s.onProcess?.(null);
      const base = { stdout: Buffer.concat(chunks).toString('utf8'), stderr: '' };
      const timeMs = Date.now() - started;
      if (killedFor) return resolve({ ...base, reason: killedFor, exitCode: null, timeMs });
      resolve({ ...base, reason: 'ok', exitCode, timeMs });
    });
  });

  return {
    done,
    stop: () => kill('stopped'),
    write: (data) => {
      if (!killedFor) pty?.write(data);
    },
    resize: (cols, rows) => {
      if (!killedFor) pty?.resize(cols, rows);
    },
  };
}

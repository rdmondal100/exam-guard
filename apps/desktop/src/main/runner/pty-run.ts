import type { PtyProcess } from '../terminal/terminal-host.js';
import type { PtyOpen } from '../terminal/pty.js';
import { resultFromReport, type LimitedResult } from './spawn-limited.js';

export interface PtyRunSpawn {
  /** Normally eg-runner, run with `--shell` so Ctrl+C reaches the program and not the job. */
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** Output (as the console shows it) past this many bytes ends the run. */
  outputCap: number;
  reportPath: string;
  size: { cols: number; rows: number };
}

export interface PtyRunHandle {
  done: Promise<LimitedResult>;
  stop(): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

/**
 * Runs one program in a pseudo-console, so prompts show at once and the student types into it
 * (the interactive mode). Same limits as a piped run: eg-runner's Job Object does time, memory
 * and processes, this module does the output cap and Stop. Everything the program printed (stdout
 * and stderr are one stream in a console) is returned as `stdout`, capped.
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
  const chunks: Buffer[] = [];
  let bytes = 0;
  let killedFor: 'output_limit' | 'stopped' | null = null;
  const kill = (why: 'output_limit' | 'stopped') => {
    if (killedFor) return;
    killedFor = why;
    pty?.kill();
  };

  const done = new Promise<LimitedResult>((resolve) => {
    const p = pty;
    if (!p) {
      return resolve({
        reason: 'failed',
        exitCode: null,
        timeMs: null,
        stdout: '',
        stderr: '',
        error: startError ?? 'The console could not start.',
      });
    }
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
      void (async () => {
        const base = { stdout: Buffer.concat(chunks).toString('utf8'), stderr: '' };
        const elapsed = Date.now() - started;
        if (killedFor) {
          return resolve({ ...base, reason: killedFor, exitCode: null, timeMs: elapsed });
        }
        resolve(await resultFromReport(s.reportPath, exitCode, base, elapsed));
      })();
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

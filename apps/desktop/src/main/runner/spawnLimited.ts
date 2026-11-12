import { spawn } from 'node:child_process';
import { killTree as defaultKillTree, type KillTree } from './killTree.js';

export type LimitReason = 'ok' | 'time_limit' | 'output_limit' | 'stopped' | 'failed';

export interface LimitedResult {
  reason: LimitReason;
  /** The program's exit code, `null` if it never ran or was killed by us. */
  exitCode: number | null;
  timeMs: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface LimitedSpawn {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string;
  /** stdout and stderr together; past this the process is killed. */
  outputCap: number;
  /** Wall time; past it the process tree is killed. */
  timeMs: number;
  /** The process started (its pid) and ended (`null`). */
  onProcess?: (pid: number | null) => void;
  killTree?: KillTree;
}

export interface LimitedHandle {
  done: Promise<LimitedResult>;
  stop(): void;
}

/**
 * Spawns one process (the compiler), feeds it stdin, collects output up to the cap and ends it at
 * the time limit or on Stop. Ending it kills its whole process tree.
 */
export function spawnLimited(s: LimitedSpawn): LimitedHandle {
  const started = Date.now();
  const child = spawn(s.command, s.args, {
    cwd: s.cwd,
    env: s.env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (child.pid !== undefined) s.onProcess?.(child.pid);
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let bytes = 0;
  let killedFor: 'output_limit' | 'stopped' | 'time_limit' | null = null;
  const kill = (why: 'output_limit' | 'stopped' | 'time_limit') => {
    if (killedFor) return;
    killedFor = why;
    if (child.pid !== undefined) (s.killTree ?? defaultKillTree)(child.pid);
    child.kill();
  };
  const timer = setTimeout(() => kill('time_limit'), s.timeMs);
  const collect = (into: Buffer[]) => (chunk: Buffer) => {
    if (killedFor) return;
    const room = s.outputCap - bytes;
    if (chunk.length > room) {
      if (room > 0) into.push(chunk.subarray(0, room));
      bytes = s.outputCap;
      kill('output_limit');
      return;
    }
    into.push(chunk);
    bytes += chunk.length;
  };
  child.stdout.on('data', collect(out));
  child.stderr.on('data', collect(err));
  // The program may exit without reading its input; that is not an error.
  child.stdin.on('error', () => {});
  child.stdin.end(s.stdin);

  const done = new Promise<LimitedResult>((resolve) => {
    let spawnError: string | null = null;
    child.on('error', (e) => {
      spawnError = e.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      s.onProcess?.(null);
      const base = {
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      };
      const elapsed = Date.now() - started;
      if (killedFor)
        return resolve({ ...base, reason: killedFor, exitCode: null, timeMs: elapsed });
      if (spawnError) {
        return resolve({
          ...base,
          reason: 'failed',
          exitCode: null,
          timeMs: null,
          error: spawnError,
        });
      }
      resolve({ ...base, reason: 'ok', exitCode: code, timeMs: elapsed });
    });
  });

  return { done, stop: () => kill('stopped') };
}

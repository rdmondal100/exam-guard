import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export type LimitReason =
  'ok' | 'time_limit' | 'memory_limit' | 'process_limit' | 'output_limit' | 'stopped' | 'failed';

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
  /** eg-runner's `--report` file. Without it the process's own exit code is used. */
  reportPath?: string;
}

export interface LimitedHandle {
  done: Promise<LimitedResult>;
  stop(): void;
}

/** eg-runner exit codes (agent/eg-runner/src/report.rs), used if the report can't be read. */
const BY_EXIT: Record<number, LimitReason> = {
  10: 'time_limit',
  11: 'memory_limit',
  12: 'process_limit',
};

const REPORT_REASONS: readonly string[] = [
  'ok',
  'time_limit',
  'memory_limit',
  'process_limit',
  'failed',
];

interface Report {
  reason: LimitReason;
  exitCode: number | null;
  timeMs: number;
  error: string | null;
}

async function readReport(path: string): Promise<Report | null> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<Report>;
    if (typeof raw.reason !== 'string' || !REPORT_REASONS.includes(raw.reason)) return null;
    return {
      reason: raw.reason,
      exitCode: typeof raw.exitCode === 'number' ? raw.exitCode : null,
      timeMs: typeof raw.timeMs === 'number' ? raw.timeMs : 0,
      error: typeof raw.error === 'string' ? raw.error : null,
    };
  } catch {
    return null;
  }
}

/**
 * How a finished eg-runner ended: from its report file, or from its own exit code when the
 * report can't be read. Without a report path the process's exit code is the program's.
 */
export async function resultFromReport(
  reportPath: string | undefined,
  code: number | null,
  base: { stdout: string; stderr: string },
  elapsedMs: number,
): Promise<LimitedResult> {
  if (!reportPath) return { ...base, reason: 'ok', exitCode: code, timeMs: elapsedMs };
  const report = await readReport(reportPath);
  if (!report) {
    const reason = (code !== null && BY_EXIT[code]) || 'failed';
    const error =
      reason === 'failed' ? `The code runner stopped unexpectedly (${code}).` : undefined;
    return { ...base, reason, exitCode: null, timeMs: elapsedMs, ...(error ? { error } : {}) };
  }
  return {
    ...base,
    reason: report.reason,
    exitCode: report.exitCode,
    timeMs: report.timeMs,
    ...(report.error ? { error: report.error } : {}),
  };
}

/** eg-runner's arguments for one limited command. */
export function runnerArgs(
  limits: { memMb: number; timeMs: number; procs: number },
  reportPath: string,
  argv: string[],
  /** Interactive runs: Ctrl+C reaches the program and does not end eg-runner. */
  shell = false,
): string[] {
  return [
    ...(shell ? ['--shell'] : []),
    '--mem',
    String(limits.memMb),
    '--time',
    String(limits.timeMs),
    '--procs',
    String(limits.procs),
    '--report',
    reportPath,
    '--',
    ...argv,
  ];
}

/**
 * Spawns one process (normally eg-runner), feeds it stdin, collects output up to the cap and
 * supports Stop. Killing eg-runner closes its Job Object, which ends the student's program too.
 */
export function spawnLimited(s: LimitedSpawn): LimitedHandle {
  const started = Date.now();
  const child = spawn(s.command, s.args, {
    cwd: s.cwd,
    env: s.env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let bytes = 0;
  let killedFor: 'output_limit' | 'stopped' | null = null;
  const kill = (why: 'output_limit' | 'stopped') => {
    if (killedFor) return;
    killedFor = why;
    child.kill();
  };
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
      void (async () => {
        const base = {
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
        };
        const elapsed = Date.now() - started;
        if (killedFor) {
          return resolve({ ...base, reason: killedFor, exitCode: null, timeMs: elapsed });
        }
        if (spawnError) {
          return resolve({
            ...base,
            reason: 'failed',
            exitCode: null,
            timeMs: null,
            error: spawnError,
          });
        }
        resolve(await resultFromReport(s.reportPath, code, base, elapsed));
      })();
    });
  });

  return { done, stop: () => kill('stopped') };
}

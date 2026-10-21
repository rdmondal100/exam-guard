import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RUN_LIMITS, type RunRequest, type RunResult } from '@examguard/shared';
import { LANGUAGES, type LanguageConfig } from './languages.js';
import { parseGcc } from './parse-gcc.js';
import { crashMessage, RUN_MESSAGES } from './run-messages.js';
import {
  runnerArgs,
  spawnLimited,
  type LimitedHandle,
  type LimitedResult,
  type LimitedSpawn,
} from './spawn-limited.js';
import type { Toolchain } from './toolchains.js';

export interface CodeRunnerDeps {
  toolchain: () => Toolchain;
  /** Run folders go under here, one per question and language. */
  workRoot: () => string;
  spawn?: (s: LimitedSpawn) => LimitedHandle;
  now?: () => number;
  /** Called after every real run (not for busy/cooldown refusals). */
  onRun?: (request: RunRequest, result: RunResult) => void;
}

const empty = {
  exitCode: null,
  timeMs: null,
  stdout: '',
  stderr: '',
  compileOutput: '',
  diagnostics: [],
} satisfies Partial<RunResult>;

const refuse = (status: 'busy' | 'cooldown' | 'failed', message: string, retryInMs?: number) =>
  ({ ...empty, status, message, ...(retryInMs !== undefined ? { retryInMs } : {}) }) as RunResult;

/** Folder names from ids: only safe characters, so an id can never climb out of the root. */
const safe = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * Compiles (C/C++) and runs one student program at a time through eg-runner, with the limits and
 * the 2 s gap from requirements §8.3. Lives in student main.
 */
export class CodeRunner {
  private current: LimitedHandle | null = null;
  private running = false;
  private stopped = false;
  private lastEnd = -Infinity;

  constructor(private readonly deps: CodeRunnerDeps) {}

  private get now(): number {
    return (this.deps.now ?? Date.now)();
  }

  stop(): void {
    this.stopped = true;
    this.current?.stop();
  }

  async run(request: RunRequest): Promise<RunResult> {
    if (this.running) return refuse('busy', RUN_MESSAGES.busy);
    const wait = this.lastEnd + RUN_LIMITS.cooldownMs - this.now;
    if (wait > 0) {
      return refuse('cooldown', `Wait ${Math.ceil(wait / 1000)} s before the next run.`, wait);
    }
    this.running = true;
    this.stopped = false;
    try {
      const result = await this.compileAndRun(request);
      this.deps.onRun?.(request, result);
      return result;
    } finally {
      this.current = null;
      this.running = false;
      this.lastEnd = this.now;
    }
  }

  private async compileAndRun(request: RunRequest): Promise<RunResult> {
    const lang = LANGUAGES[request.language];
    const tools = this.deps.toolchain();
    if (!tools.runner) return refuse('failed', 'The code runner (eg-runner) is not installed.');
    if (lang.compile && !tools.mingwBin) {
      return refuse('failed', `The ${lang.label} compiler is not installed on this computer.`);
    }
    const dir = join(this.deps.workRoot(), safe(request.questionId), lang.id);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, lang.fileName), request.code, 'utf8');
    for (const [name, text] of Object.entries(lang.files ?? {})) {
      await writeFile(join(dir, name), text, 'utf8');
    }
    // MinGW first on PATH, so compiled programs load its runtime DLLs and not another copy.
    const env = {
      ...process.env,
      ...(tools.mingwBin ? { PATH: `${tools.mingwBin};${process.env.PATH ?? ''}` } : {}),
      ...lang.env,
    };
    const exec = (argv: string[], limits: { memMb: number; timeMs: number }, stdin: string) => {
      const reportPath = join(dir, '.eg-report.json');
      const handle = (this.deps.spawn ?? spawnLimited)({
        command: tools.runner ?? '',
        args: runnerArgs({ ...limits, procs: RUN_LIMITS.processes }, reportPath, argv),
        cwd: dir,
        env,
        stdin,
        outputCap: RUN_LIMITS.outputBytes,
        reportPath,
      });
      this.current = handle;
      if (this.stopped) handle.stop();
      return handle.done;
    };

    let compileOutput = '';
    let diagnostics: RunResult['diagnostics'] = [];
    if (lang.compile) {
      const compiled = await exec(
        lang.compile(tools),
        { memMb: RUN_LIMITS.compileMemoryMb, timeMs: RUN_LIMITS.compileTimeMs },
        '',
      );
      compileOutput = (compiled.stderr + compiled.stdout).trim();
      diagnostics = parseGcc(compileOutput, lang.fileName);
      const failed = this.compileFailure(compiled, lang);
      if (failed) return { ...empty, ...failed, compileOutput, diagnostics };
    }
    const ran = await exec(
      lang.run(tools, dir),
      { memMb: RUN_LIMITS.memoryMb, timeMs: RUN_LIMITS.timeMs },
      request.stdin,
    );
    return { ...this.toResult(ran), compileOutput, diagnostics };
  }

  private compileFailure(
    r: LimitedResult,
    lang: LanguageConfig,
  ): Pick<RunResult, 'status' | 'message'> | null {
    if (r.reason === 'stopped') return { status: 'stopped', message: RUN_MESSAGES.stopped };
    if (r.reason === 'failed') {
      return {
        status: 'failed',
        message: r.error ?? `Could not start the ${lang.label} compiler.`,
      };
    }
    if (r.reason !== 'ok') {
      return { status: 'failed', message: `The ${lang.label} compiler hit a limit (${r.reason}).` };
    }
    if (r.exitCode !== 0) return { status: 'compile_error', message: RUN_MESSAGES.compile_error };
    return null;
  }

  private toResult(r: LimitedResult): Omit<RunResult, 'compileOutput' | 'diagnostics'> {
    const base = { exitCode: r.exitCode, timeMs: r.timeMs, stdout: r.stdout, stderr: r.stderr };
    if (r.reason === 'ok') return { ...base, status: 'ok', message: crashMessage(r.exitCode) };
    if (r.reason === 'failed') {
      return { ...base, status: 'failed', message: r.error ?? 'The program could not be started.' };
    }
    return { ...base, status: r.reason, message: RUN_MESSAGES[r.reason] };
  }
}

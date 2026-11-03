import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_RUN_LIMITS,
  RUN_LIMITS,
  type RunLimits,
  type RunRequest,
  type RunResult,
  type RunSize,
} from '@examguard/shared';
import type { PtyOpen } from '../terminal/pty.js';
import { terminalEnv, terminalPaths } from '../terminal/terminal-env.js';
import { LANGUAGES, type LanguageConfig } from './languages.js';
import { parseGcc } from './parse-gcc.js';
import { ptyRun, type PtyRunHandle } from './pty-run.js';
import { crashMessage, limitMessage, RUN_MESSAGES } from './run-messages.js';
import {
  runnerArgs,
  spawnLimited,
  type LimitedHandle,
  type LimitedResult,
  type LimitedSpawn,
} from './spawn-limited.js';
import { splitFlags } from './split-flags.js';
import type { Toolchain } from './toolchains.js';

export interface CodeRunnerDeps {
  toolchain: () => Toolchain;
  /** Run folders go under here, one per question and language; `workspace\` sits next to them. */
  workRoot: () => string;
  /** Main's environment; the program gets the terminal's version of it (workspace paths). */
  baseEnv?: NodeJS.ProcessEnv;
  spawn?: (s: LimitedSpawn) => LimitedHandle;
  /** Opens the pseudo-console the program runs in. */
  openPty?: PtyOpen;
  /** Output of the program as it is produced. */
  onData?: (data: string) => void;
  /** The exam's limits (M43: from the session state, fixed when hosting started). */
  limits?: () => RunLimits;
  /** Wall time of the program; tests shorten it (wins over `limits`). */
  runTimeMs?: number;
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

const failed = (error: string): LimitedResult => ({
  reason: 'failed',
  exitCode: null,
  timeMs: null,
  stdout: '',
  stderr: '',
  error,
});

/** Folder names from ids: only safe characters, so an id can never climb out of the root. */
const safe = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * Compiles (C/C++) and runs one student program at a time through eg-runner, with the limits and
 * the 2 s gap from requirements §8.3. Lives in student main. The compiler runs piped; the program
 * runs in a pseudo-console, so prompts, typing and window programs (GLUT, graphics.h) all work.
 */
export class CodeRunner {
  private current: { stop(): void } | null = null;
  private pty: PtyRunHandle | null = null;
  private size: RunSize = { cols: 80, rows: 24 };
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

  /** Keystrokes for the program of an interactive run. */
  write(data: string): void {
    this.pty?.write(data);
  }

  /** The console's size; used by the next interactive run and by the one going now. */
  resize(size: RunSize): void {
    this.size = size;
    this.pty?.resize(size.cols, size.rows);
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
      this.pty = null;
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
    const missing = lang.unavailable?.(tools);
    if (missing) return refuse('failed', missing);
    const flags = splitFlags(request.flags);
    if (!flags) return refuse('failed', 'These flags cannot be used. Check for a missing quote.');
    const root = this.deps.workRoot();
    const dir = join(root, safe(request.questionId), lang.id);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    // The program runs in the workspace (cwd), where the terminal works and where the student's
    // own files live; the wiped `dir` keeps only the source, the build output and helper files.
    const paths = terminalPaths(root);
    await mkdir(paths.workspace, { recursive: true });
    await writeFile(join(dir, lang.fileName), request.code, 'utf8');
    for (const [name, text] of Object.entries(lang.files ?? {})) {
      await writeFile(join(dir, name), text, 'utf8');
    }
    // The terminal's environment: MinGW and the student's packages on PATH, include/lib folders
    // from the workspace, no ExamGuard variables. MinGW comes before the system PATH, so compiled
    // programs load its runtime DLLs and not another copy.
    const env = {
      ...terminalEnv({
        base: this.deps.baseEnv ?? process.env,
        paths,
        mingwBin: tools.mingwBin,
      }),
      ...lang.env,
    };
    const reportPath = join(dir, '.eg-report.json');
    const limits = this.deps.limits?.() ?? DEFAULT_RUN_LIMITS;
    const runMs = this.deps.runTimeMs ?? limits.timeMs;
    // Only the compiler runs piped; the program itself runs in the console (`execPty`).
    const exec = (argv: string[], compileLimits: { memMb: number; timeMs: number }) => {
      const handle = (this.deps.spawn ?? spawnLimited)({
        command: tools.runner ?? '',
        args: runnerArgs({ ...compileLimits, procs: limits.processes }, reportPath, argv),
        cwd: dir,
        env,
        stdin: '',
        outputCap: limits.outputBytes,
        reportPath,
      });
      this.current = handle;
      if (this.stopped) handle.stop();
      return handle.done;
    };
    const execPty = (argv: string[]) => {
      const open = this.deps.openPty;
      if (!open) return Promise.resolve(failed('The program console is not available.'));
      const handle = ptyRun(
        {
          command: tools.runner ?? '',
          args: runnerArgs(
            { memMb: limits.memoryMb, timeMs: runMs, procs: limits.processes },
            reportPath,
            argv,
            true,
          ),
          cwd: paths.workspace,
          env,
          outputCap: limits.outputBytes,
          reportPath,
          size: this.size,
        },
        open,
        (data) => this.deps.onData?.(data),
      );
      this.current = handle;
      this.pty = handle;
      if (this.stopped) handle.stop();
      return handle.done;
    };

    let compileOutput = '';
    let diagnostics: RunResult['diagnostics'] = [];
    if (lang.compile) {
      const compiled = await exec(lang.compile(tools, flags), {
        memMb: RUN_LIMITS.compileMemoryMb,
        timeMs: RUN_LIMITS.compileTimeMs,
      });
      compileOutput = (compiled.stderr + compiled.stdout).trim();
      diagnostics = parseGcc(compileOutput, lang.fileName);
      const failure = this.compileFailure(compiled, lang);
      if (failure) return { ...empty, ...failure, compileOutput, diagnostics };
    }
    const argv = lang.run(tools, dir, lang.compile ? [] : flags);
    const ran = await execPty(argv);
    return { ...this.toResult(ran, limits, runMs), compileOutput, diagnostics };
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

  private toResult(
    r: LimitedResult,
    limits: RunLimits,
    timeLimitMs: number,
  ): Omit<RunResult, 'compileOutput' | 'diagnostics'> {
    const base = { exitCode: r.exitCode, timeMs: r.timeMs, stdout: r.stdout, stderr: r.stderr };
    if (r.reason === 'ok') return { ...base, status: 'ok', message: crashMessage(r.exitCode) };
    if (r.reason === 'failed') {
      return { ...base, status: 'failed', message: r.error ?? 'The program could not be started.' };
    }
    const message =
      r.reason === 'stopped' ? RUN_MESSAGES.stopped : limitMessage(r.reason, limits, timeLimitMs);
    return { ...base, status: r.reason, message };
  }
}

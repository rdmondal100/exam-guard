import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunLimits, RunRequest, RunResult } from '@examguard/shared';
import { CodeRunner, type CodeRunnerDeps } from './codeRunner.js';
import type { PtyOpen } from '../terminal/pty.js';
import type { LimitedHandle, LimitedResult, LimitedSpawn } from './spawnLimited.js';
import type { Toolchain } from './toolchains.js';

const OK: LimitedResult = { reason: 'ok', exitCode: 0, timeMs: 12, stdout: '', stderr: '' };
const COMPILER_PID = 77;
const PROGRAM_PID = 99;

/** A scripted step: a compile result, or how the program ends (`hang`: it never does by itself). */
type Step = Partial<LimitedResult> & { hang?: boolean };

let root: string;
let clock: number;
let spawned: LimitedSpawn[];
let opened: Parameters<PtyOpen>[];
let script: Step[];
let ran: [RunRequest, RunResult][];
let tools: Toolchain;
let hold: { release: () => void } | null;
let processes: [string, number | null][];
let trees: number[];

const fakeSpawn = (s: LimitedSpawn): LimitedHandle => {
  spawned.push(s);
  s.onProcess?.(COMPILER_PID);
  const result = { ...OK, ...script.shift() };
  let stop = () => {};
  const done = (
    hold
      ? new Promise<LimitedResult>((resolve) => {
          stop = () => resolve({ ...result, reason: 'stopped' });
          hold = { release: () => resolve(result) };
        })
      : Promise.resolve(result)
  ).finally(() => s.onProcess?.(null));
  return { done, stop: () => stop() };
};

/** The program's console: prints and exits as scripted, or hangs until it is killed. */
const fakePty: PtyOpen = (spec, size) => {
  opened.push([spec, size]);
  const step = script.shift() ?? {};
  let onData: (d: string) => void = () => {};
  let onExit: (code: number) => void = () => {};
  const finish = () => {
    if (step.stdout) onData(step.stdout);
    onExit(step.exitCode ?? 0);
  };
  if (hold) hold = { release: finish };
  else if (!step.hang) setTimeout(finish, 0);
  return {
    pid: PROGRAM_PID,
    onData: (l) => void (onData = l),
    onExit: (l) => void (onExit = l),
    write: () => {},
    resize: () => {},
    kill: () => onExit(1),
  };
};

const runner = (over: Partial<CodeRunnerDeps> = {}) =>
  new CodeRunner({
    toolchain: () => tools,
    workRoot: () => root,
    spawn: fakeSpawn,
    openPty: fakePty,
    now: () => clock,
    onRun: (req, res) => ran.push([req, res]),
    onProcess: (slot, pid) => processes.push([slot, pid]),
    killTree: (pid) => void trees.push(pid),
    comspec: 'cmd.exe',
    ...over,
  });

const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  questionId: 'q-1',
  language: 'c',
  code: 'int main(){return 0;}',
  flags: '',
  ...over,
});

const argv = (index = 0) => {
  const spec = opened[index]?.[0];
  if (!spec) return [];
  return typeof spec.args === 'string' ? [spec.file, spec.args] : [spec.file, ...spec.args];
};
/** The quoted command line cmd.exe hosts a JavaScript run with (cmd-host.ts). */
const hosted = (parts: string[]) => [
  'cmd.exe',
  `/d /s /c "${parts.map((p) => `"${p}"`).join(' ')}"`,
];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eg-runner-'));
  clock = 1_000_000;
  spawned = [];
  opened = [];
  script = [];
  ran = [];
  hold = null;
  processes = [];
  trees = [];
  tools = {
    mingwBin: 'C:\\mingw\\bin',
    nodeExe: 'electron.exe',
    msysRoot: null,
    npmCli: null,
    pythonExe: 'python.exe',
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('CodeRunner', () => {
  it('compiles C with the configured flags, then runs the program itself in the console', async () => {
    script = [{}, { stdout: 'hi', exitCode: 0 }];
    const result = await runner().run(req());
    expect(result).toMatchObject({ status: 'ok', stdout: 'hi', exitCode: 0, message: '' });
    const dir = join(root, 'q-1', 'c');
    expect(readFileSync(join(dir, 'main.c'), 'utf8')).toBe('int main(){return 0;}');
    const [compile] = spawned;
    expect(compile?.command).toBe(join('C:\\mingw\\bin', 'gcc.exe'));
    expect(compile?.args).toEqual([
      '-specs=eg.specs',
      '-std=c11',
      '-O2',
      '-Wall',
      'main.c',
      '-o',
      'main.exe',
    ]);
    expect(compile?.timeMs).toBe(15_000);
    expect(existsSync(join(dir, 'eg.specs'))).toBe(true);
    expect(argv()).toEqual([join(dir, 'main.exe')]);
    // The program runs in the workspace; the build folder only holds source and output.
    const run = opened[0]?.[0];
    expect(run?.cwd).toBe(join(root, 'workspace'));
    expect(run?.env.PATH?.split(';')).toContain('C:\\mingw\\bin');
    expect(ran).toHaveLength(1);
    // The monitor counts both as the student's own programs while they run.
    expect(processes).toEqual([
      ['compile', COMPILER_PID],
      ['compile', null],
      ['run', PROGRAM_PID],
      ['run', null],
    ]);
  });

  it('uses g++ -std=c++17 for C++ and Electron as Node, hosted by cmd, for JS', async () => {
    await runner().run(req({ language: 'cpp' }));
    expect(spawned[0]?.args).toContain('-std=c++17');
    expect(spawned[0]?.command).toBe(join('C:\\mingw\\bin', 'g++.exe'));
    clock += 5000;
    spawned = [];
    opened = [];
    await runner().run(req({ language: 'js' }));
    expect(spawned).toHaveLength(0);
    expect(argv()).toEqual(
      hosted([
        'electron.exe',
        '-r',
        join(root, 'q-1', 'js', 'eg-stdin.cjs'),
        join(root, 'q-1', 'js', 'main.js'),
      ]),
    );
    expect(opened[0]?.[0].env.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('runs Python straight in the console, with the workspace on PYTHONPATH', async () => {
    const r = await runner().run(req({ language: 'py' }));
    expect(r.status).toBe('ok');
    expect(spawned).toHaveLength(0);
    expect(argv().slice(-2)).toEqual(['python.exe', join(root, 'q-1', 'py', 'main.py')]);
    const env = opened[0]?.[0].env;
    expect(env?.PYTHONUTF8).toBe('1');
    expect(env?.OPENBLAS_NUM_THREADS).toBe('1');
    expect(env?.PYTHONPATH).toBe(
      [join(root, 'workspace', 'site-packages'), join(root, 'workspace')].join(';'),
    );
    expect(opened[0]?.[0].cwd).toBe(join(root, 'workspace'));
    expect(env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it('refuses a Python run when Python is not installed', async () => {
    tools = { ...tools, pythonExe: null };
    expect(await runner().run(req({ language: 'py' }))).toMatchObject({
      status: 'failed',
      message: 'Python is not installed on this computer.',
    });
    expect(opened).toHaveLength(0);
  });

  it('stops at a compile error with diagnostics and does not run', async () => {
    script = [{ exitCode: 1, stderr: "main.c:1:12: error: expected ';' before '}' token\n" }];
    const result = await runner().run(req());
    expect(result.status).toBe('compile_error');
    expect(result.diagnostics).toEqual([
      { line: 1, col: 12, severity: 'error', message: "expected ';' before '}' token" },
    ]);
    expect(result.compileOutput).toContain('error');
    expect(spawned).toHaveLength(1);
    expect(opened).toHaveLength(0);
  });

  it('says so when the compiler takes too long', async () => {
    script = [{ reason: 'time_limit', exitCode: null }];
    expect(await runner().run(req())).toMatchObject({ status: 'failed', message: /too long/ });
  });

  it('ends a program past the time limit with its whole process tree', async () => {
    script = [{}, { hang: true }];
    const result = await runner({ runTimeMs: 30 }).run(req());
    expect(result.status).toBe('time_limit');
    expect(result.message).toMatch(/longer than 0.03 s/);
    expect(trees).toEqual([PROGRAM_PID]);
  });

  it("runs with the exam's own limits from Settings (M43) and names them", async () => {
    const limits: RunLimits = { timeMs: 50, outputBytes: 8192 };
    script = [{}, { hang: true }];
    const result = await runner({ limits: () => limits }).run(req());
    expect(spawned[0]?.outputCap).toBe(8192);
    expect(result.message).toMatch(/longer than 0.05 s/);
  });

  it('explains the output limit', async () => {
    script = [{}, { stdout: 'x'.repeat(100) }];
    const result = await runner({ limits: () => ({ timeMs: 60_000, outputBytes: 10 }) }).run(req());
    expect(result.status).toBe('output_limit');
    expect(result.stdout).toBe('x'.repeat(10));
  });

  it('explains a crash exit code', async () => {
    script = [{}, { exitCode: 0xc0000005 | 0 }];
    expect((await runner().run(req())).message).toMatch(/access violation/);
  });

  it('wipes the work folder before each run', async () => {
    const dir = join(root, 'q-1', 'c');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'old.txt'), 'x');
    await runner().run(req());
    expect(existsSync(join(dir, 'old.txt'))).toBe(false);
  });

  it('keeps an odd question id inside the work root', async () => {
    await runner().run(req({ questionId: '..\\..\\evil' }));
    expect(spawned[0]?.cwd.startsWith(root)).toBe(true);
    expect(spawned[0]?.cwd).toBe(join(root, '______evil', 'c'));
  });

  it('refuses a second run while one is going, and Stop ends it', async () => {
    hold = { release: () => {} };
    const r = runner();
    const first = r.run(req({ language: 'js' }));
    await new Promise((res) => setTimeout(res, 20));
    expect(await r.run(req())).toMatchObject({ status: 'busy' });
    r.stop();
    expect((await first).status).toBe('stopped');
    expect(trees).toEqual([PROGRAM_PID]);
    expect(ran).toHaveLength(1);
  });

  it('keeps a 2 s gap between runs', async () => {
    const r = runner();
    await r.run(req({ language: 'js' }));
    clock += 500;
    expect(await r.run(req())).toMatchObject({ status: 'cooldown', retryInMs: 1500 });
    clock += 1500;
    expect((await r.run(req({ language: 'js' }))).status).toBe('ok');
    expect(ran).toHaveLength(2);
  });

  it('says what is missing instead of running', async () => {
    tools = { ...tools, mingwBin: null };
    expect(await runner().run(req())).toMatchObject({ status: 'failed', message: /C compiler/ });
    expect(spawned).toHaveLength(0);
    expect(opened).toHaveLength(0);
  });
});

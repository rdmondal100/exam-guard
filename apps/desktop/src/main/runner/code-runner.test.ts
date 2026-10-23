import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunRequest, RunResult } from '@examguard/shared';
import { CodeRunner } from './code-runner.js';
import type { PtyOpen } from '../terminal/pty.js';
import type { LimitedHandle, LimitedResult, LimitedSpawn } from './spawn-limited.js';
import type { Toolchain } from './toolchains.js';

const OK: LimitedResult = { reason: 'ok', exitCode: 0, timeMs: 12, stdout: '', stderr: '' };

let root: string;
let clock: number;
let spawned: LimitedSpawn[];
let opened: Parameters<PtyOpen>[];
let script: Partial<LimitedResult>[];
let ran: [RunRequest, RunResult][];
let tools: Toolchain;
let hold: { release: () => void } | null;

const fakeSpawn = (s: LimitedSpawn): LimitedHandle => {
  spawned.push(s);
  const result = { ...OK, ...script.shift() };
  let stop = () => {};
  const done = hold
    ? new Promise<LimitedResult>((resolve) => {
        stop = () => resolve({ ...result, reason: 'stopped' });
        hold = { release: () => resolve(result) };
      })
    : Promise.resolve(result);
  return { done, stop: () => stop() };
};

/** The program's console: ends as scripted (through the report file, like eg-runner does). */
const fakePty: PtyOpen = (spec, size) => {
  opened.push([spec, size]);
  const result = { ...OK, ...script.shift() };
  let onData: (d: string) => void = () => {};
  let onExit: (code: number) => void = () => {};
  const finish = () => {
    const report = spec.args[spec.args.indexOf('--report') + 1] ?? '';
    const { reason, exitCode, timeMs } = result;
    writeFileSync(report, JSON.stringify({ reason, exitCode, timeMs, error: null }));
    if (result.stdout) onData(result.stdout);
    onExit(0);
  };
  if (hold) hold = { release: finish };
  else setTimeout(finish, 0);
  return {
    onData: (l) => void (onData = l),
    onExit: (l) => void (onExit = l),
    write: () => {},
    resize: () => {},
    kill: () => onExit(1),
  };
};

const runner = () =>
  new CodeRunner({
    toolchain: () => tools,
    workRoot: () => root,
    spawn: fakeSpawn,
    openPty: fakePty,
    now: () => clock,
    onRun: (req, res) => ran.push([req, res]),
  });

const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  questionId: 'q-1',
  language: 'c',
  code: 'int main(){return 0;}',
  flags: '',
  ...over,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eg-runner-'));
  clock = 1_000_000;
  spawned = [];
  opened = [];
  script = [];
  ran = [];
  hold = null;
  tools = {
    runner: 'eg-runner.exe',
    mingwBin: 'C:\\mingw\\bin',
    nodeExe: 'electron.exe',
    msysRoot: null,
    npmCli: null,
    pythonExe: 'python.exe',
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('CodeRunner', () => {
  it('compiles C with the configured flags, then runs it in the console with the limits', async () => {
    script = [{}, { stdout: 'hi', exitCode: 0, timeMs: 30 }];
    const result = await runner().run(req());
    expect(result).toMatchObject({
      status: 'ok',
      stdout: 'hi',
      exitCode: 0,
      timeMs: 30,
      message: '',
    });
    const dir = join(root, 'q-1', 'c');
    expect(readFileSync(join(dir, 'main.c'), 'utf8')).toBe('int main(){return 0;}');
    const [compile] = spawned;
    const [run] = opened.map(([spec]) => spec);
    expect(compile?.args).toEqual([
      '--mem',
      '1024',
      '--time',
      '15000',
      '--procs',
      '8',
      '--report',
      join(dir, '.eg-report.json'),
      '--',
      join('C:\\mingw\\bin', 'gcc.exe'),
      '-specs=eg.specs',
      '-std=c11',
      '-O2',
      '-Wall',
      'main.c',
      '-o',
      'main.exe',
    ]);
    expect(existsSync(join(dir, 'eg.specs'))).toBe(true);
    expect(run?.file).toBe('eg-runner.exe');
    expect(run?.args.slice(0, 7)).toEqual([
      '--shell',
      '--mem',
      '256',
      '--time',
      '600000',
      '--procs',
      '8',
    ]);
    expect(run?.args.at(-1)).toBe(join(dir, 'main.exe'));
    // The program runs in the workspace; the build folder only holds source and output.
    expect(run?.cwd).toBe(join(root, 'workspace'));
    expect(run?.env.PATH?.split(';')).toContain('C:\\mingw\\bin');
    expect(ran).toHaveLength(1);
  });

  it('uses g++ -std=c++17 for C++ and Electron as Node for JS', async () => {
    await runner().run(req({ language: 'cpp' }));
    expect(spawned[0]?.args).toContain('-std=c++17');
    expect(spawned[0]?.args).toContain(join('C:\\mingw\\bin', 'g++.exe'));
    clock += 5000;
    spawned = [];
    opened = [];
    await runner().run(req({ language: 'js' }));
    expect(spawned).toHaveLength(0);
    expect(opened[0]?.[0].args.slice(-4)).toEqual([
      'electron.exe',
      '-r',
      join(root, 'q-1', 'js', 'eg-stdin.cjs'),
      join(root, 'q-1', 'js', 'main.js'),
    ]);
    expect(opened[0]?.[0].env.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('runs Python straight in the console, with the workspace on PYTHONPATH', async () => {
    const r = await runner().run(req({ language: 'py' }));
    expect(r.status).toBe('ok');
    expect(spawned).toHaveLength(0);
    expect(opened[0]?.[0].args.slice(-2)).toEqual([
      'python.exe',
      join(root, 'q-1', 'py', 'main.py'),
    ]);
    const env = opened[0]?.[0].env;
    expect(env?.PYTHONUTF8).toBe('1');
    // NumPy would otherwise reserve a buffer per core and hit the memory limit on import.
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

  it.each([
    ['time_limit', /longer than 10 min/],
    ['memory_limit', /256 MB/],
    ['process_limit', /too many processes/],
  ] as const)('explains %s', async (reason, message) => {
    script = [{}, { reason }];
    const result = await runner().run(req());
    expect(result.status).toBe(reason);
    expect(result.message).toMatch(message);
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
    tools = { ...tools, runner: null };
    clock += 5000;
    expect(await runner().run(req({ language: 'js' }))).toMatchObject({
      status: 'failed',
      message: /eg-runner/,
    });
    expect(spawned).toHaveLength(0);
    expect(opened).toHaveLength(0);
  });
});

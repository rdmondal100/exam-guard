import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunRequest, RunResult } from '@examguard/shared';
import { CodeRunner } from './code-runner.js';
import type { LimitedHandle, LimitedResult, LimitedSpawn } from './spawn-limited.js';
import type { Toolchain } from './toolchains.js';

const OK: LimitedResult = { reason: 'ok', exitCode: 0, timeMs: 12, stdout: '', stderr: '' };

let root: string;
let clock: number;
let spawned: LimitedSpawn[];
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

const runner = () =>
  new CodeRunner({
    toolchain: () => tools,
    workRoot: () => root,
    spawn: fakeSpawn,
    now: () => clock,
    onRun: (req, res) => ran.push([req, res]),
  });

const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  questionId: 'q-1',
  language: 'c',
  code: 'int main(){return 0;}',
  stdin: 'in',
  ...over,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eg-runner-'));
  clock = 1_000_000;
  spawned = [];
  script = [];
  ran = [];
  hold = null;
  tools = {
    runner: 'eg-runner.exe',
    mingwBin: 'C:\\mingw\\bin',
    nodeExe: 'electron.exe',
    msysRoot: null,
    npmCli: null,
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('CodeRunner', () => {
  it('compiles C with the configured flags, then runs it with stdin and limits', async () => {
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
    const [compile, run] = spawned;
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
    expect(run?.args.slice(0, 6)).toEqual(['--mem', '256', '--time', '5000', '--procs', '8']);
    expect(run?.args.at(-1)).toBe(join(dir, 'main.exe'));
    expect(run).toMatchObject({ stdin: 'in', cwd: dir, outputCap: 65536 });
    expect(run?.env.PATH?.startsWith('C:\\mingw\\bin;')).toBe(true);
    expect(ran).toHaveLength(1);
  });

  it('uses g++ -std=c++17 for C++ and Electron as Node for JS', async () => {
    await runner().run(req({ language: 'cpp' }));
    expect(spawned[0]?.args).toContain('-std=c++17');
    expect(spawned[0]?.args).toContain(join('C:\\mingw\\bin', 'g++.exe'));
    clock += 5000;
    spawned = [];
    await runner().run(req({ language: 'js' }));
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.args.slice(-2)).toEqual(['electron.exe', 'main.js']);
    expect(spawned[0]?.env.ELECTRON_RUN_AS_NODE).toBe('1');
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
  });

  it.each([
    ['time_limit', /longer than 5 s/],
    ['memory_limit', /256 MB/],
    ['output_limit', /64 KB/],
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
  });
});

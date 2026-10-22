import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunRequest } from '@examguard/shared';
import type { PtyOpen } from '../terminal/pty.js';
import type { PtyProcess } from '../terminal/terminal-host.js';
import { CodeRunner } from './code-runner.js';
import type { LimitedHandle, LimitedResult, LimitedSpawn } from './spawn-limited.js';
import type { Toolchain } from './toolchains.js';

const OK: LimitedResult = { reason: 'ok', exitCode: 0, timeMs: 12, stdout: '', stderr: '' };

let root: string;
let spawned: LimitedSpawn[];
let ptys: FakePty[];
let opened: Parameters<PtyOpen>[];
let tools: Toolchain;
/** Fake consoles end by themselves unless a test wants to drive them. */
let auto: boolean;

/** A pty that prints a prompt and ends when told (or killed). */
class FakePty implements PtyProcess {
  written: string[] = [];
  sizes: [number, number][] = [];
  killed = false;
  private dataListener: (d: string) => void = () => {};
  private exitListener: (code: number) => void = () => {};
  onData(l: (d: string) => void) {
    this.dataListener = l;
  }
  onExit(l: (code: number) => void) {
    this.exitListener = l;
  }
  write(d: string) {
    this.written.push(d);
  }
  resize(c: number, r: number) {
    this.sizes.push([c, r]);
  }
  kill() {
    this.killed = true;
    this.exitListener(1);
  }
  print(text: string) {
    this.dataListener(text);
  }
  exit(code = 0) {
    this.exitListener(code);
  }
}

const fakeSpawn = (s: LimitedSpawn): LimitedHandle => {
  spawned.push(s);
  return { done: Promise.resolve(OK), stop: () => {} };
};
const openPty: PtyOpen = (spec, size) => {
  opened.push([spec, size]);
  const pty = new FakePty();
  ptys.push(pty);
  if (auto) setTimeout(() => pty.exit(0), 0);
  return pty;
};

const runner = (extra: Partial<ConstructorParameters<typeof CodeRunner>[0]> = {}) =>
  new CodeRunner({
    toolchain: () => tools,
    workRoot: () => root,
    baseEnv: { PATH: 'C:\\Windows', EG_SECRET: 'x', ELECTRON_RUN_AS_NODE: '1' },
    spawn: fakeSpawn,
    openPty,
    ...extra,
  });

const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  questionId: 'q1',
  language: 'c',
  code: 'int main(){return 0;}',
  flags: '',
  ...over,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eg-console-'));
  spawned = [];
  auto = true;
  ptys = [];
  opened = [];
  tools = {
    runner: 'eg-runner.exe',
    mingwBin: 'C:\\mingw\\bin',
    nodeExe: 'electron.exe',
    msysRoot: null,
    npmCli: null,
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('student flags', () => {
  it('puts them after the source and before our -o, split like a shell would', async () => {
    await runner().run(req({ flags: '-lfreeglut -lopengl32 "-DNAME=a b" -std=c99' }));
    const compile = spawned[0]?.args ?? [];
    const argv = compile.slice(compile.indexOf('--') + 1);
    expect(argv.slice(-7)).toEqual([
      'main.c',
      '-lfreeglut',
      '-lopengl32',
      '-DNAME=a b',
      '-std=c99',
      '-o',
      'main.exe',
    ]);
    expect(argv.indexOf('-std=c99')).toBeGreaterThan(argv.indexOf('-std=c11'));
  });

  it('gives them to Node for JavaScript, before the file', async () => {
    await runner().run(req({ language: 'js', flags: '--stack-size=2000' }));
    expect(opened[0]?.[0].args.slice(-5)).toEqual([
      'electron.exe',
      '-r',
      './eg-stdin.cjs',
      '--stack-size=2000',
      'main.js',
    ]);
  });

  it('does not run anything for flags with an unclosed quote', async () => {
    const result = await runner().run(req({ flags: '-I"C:\\libs' }));
    expect(result).toMatchObject({ status: 'failed', message: /flags/ });
    expect(spawned).toHaveLength(0);
    expect(opened).toHaveLength(0);
  });
});

describe('workspace environment', () => {
  it('gives runs the include/lib folders and packages of the workspace, without ExamGuard variables', async () => {
    await runner().run(req());
    const env = spawned[0]?.env ?? {};
    expect(opened[0]?.[0].env.C_INCLUDE_PATH).toBe(env.C_INCLUDE_PATH);
    const workspace = join(root, 'workspace');
    expect(env.C_INCLUDE_PATH?.split(';')).toContain(join(workspace, 'include'));
    expect(env.LIBRARY_PATH?.split(';')).toContain(join(workspace, 'lib'));
    expect(env.PATH?.split(';')).toEqual(
      expect.arrayContaining([join(workspace, '.msys', 'ucrt64', 'bin'), 'C:\\mingw\\bin']),
    );
    expect(env.EG_SECRET).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it('points Node at the workspace node_modules', async () => {
    await runner().run(req({ language: 'js' }));
    const env = opened[0]?.[0].env ?? {};
    expect(env.NODE_PATH).toBe(join(root, 'workspace', 'node_modules'));
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
  });
});

describe('the program console', () => {
  beforeEach(() => {
    auto = false;
  });

  it('compiles piped, then runs in a pty under eg-runner --shell', async () => {
    const text: string[] = [];
    const running = runner({ runTimeMs: 30_000, onData: (d) => text.push(d) }).run(
      req({ flags: '-lm' }),
    );
    await new Promise((res) => setTimeout(res, 30));
    expect(spawned).toHaveLength(1);
    expect(opened).toHaveLength(1);
    const [spec, size] = opened[0] ?? [];
    expect(spec?.file).toBe('eg-runner.exe');
    expect(spec?.args.slice(0, 7)).toEqual([
      '--shell',
      '--mem',
      '256',
      '--time',
      '30000',
      '--procs',
      '8',
    ]);
    expect(spec?.args.at(-1)).toMatch(/main\.exe$/);
    expect(size).toEqual({ cols: 80, rows: 24 });
    ptys[0]?.print('Enter a number: ');
    ptys[0]?.exit(0);
    const result = await running;
    expect(text).toEqual(['Enter a number: ']);
    expect(result.stdout).toBe('Enter a number: ');
  });

  it('forwards keystrokes and resizes to the running program and remembers the size', async () => {
    const r = runner();
    const running = r.run(req({ language: 'js' }));
    await new Promise((res) => setTimeout(res, 30));
    r.write('42\r');
    r.resize({ cols: 100, rows: 30 });
    expect(ptys[0]?.written).toEqual(['42\r']);
    expect(ptys[0]?.sizes).toEqual([[100, 30]]);
    ptys[0]?.exit(0);
    await running;
    r.write('ignored');
    expect(ptys[0]?.written).toEqual(['42\r']);
  });

  it('uses a console size set before the run', async () => {
    const r = runner();
    r.resize({ cols: 120, rows: 40 });
    const running = r.run(req({ language: 'js' }));
    await new Promise((res) => setTimeout(res, 30));
    expect(opened[0]?.[1]).toEqual({ cols: 120, rows: 40 });
    ptys[0]?.exit(0);
    await running;
  });

  it('Stop ends the run', async () => {
    const r = runner();
    const running = r.run(req({ language: 'js' }));
    await new Promise((res) => setTimeout(res, 30));
    r.stop();
    expect(ptys[0]?.killed).toBe(true);
    expect((await running).status).toBe('stopped');
  });

  it('fails clearly when no console can be opened', async () => {
    const r = new CodeRunner({ toolchain: () => tools, workRoot: () => root, spawn: fakeSpawn });
    expect(await r.run(req({ language: 'js' }))).toMatchObject({
      status: 'failed',
      message: /console/,
    });
  });
});

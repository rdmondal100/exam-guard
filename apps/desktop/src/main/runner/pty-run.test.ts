import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PtyOpen } from '../terminal/pty.js';
import { ptyRun, type PtyRunSpawn } from './pty-run.js';

let dir: string;
let data: (d: string) => void;
let exit: (code: number) => void;
let killed: number;
let written: string[];

const open: PtyOpen = () => ({
  onData: (l) => {
    data = l;
  },
  onExit: (l) => {
    exit = l;
  },
  write: (d) => void written.push(d),
  resize: () => {},
  kill: () => {
    killed++;
    exit(1);
  },
});

const spawnOf = (over: Partial<PtyRunSpawn> = {}): PtyRunSpawn => ({
  command: 'eg-runner.exe',
  args: [],
  cwd: dir,
  env: {},
  outputCap: 100,
  reportPath: join(dir, 'report.json'),
  size: { cols: 80, rows: 24 },
  ...over,
});

const report = (r: object) => writeFileSync(join(dir, 'report.json'), JSON.stringify(r));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-ptyrun-'));
  killed = 0;
  written = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ptyRun', () => {
  it('returns what the program printed and its exit code from the report', async () => {
    const seen: string[] = [];
    const h = ptyRun(spawnOf(), open, (d) => seen.push(d));
    data('Menu> ');
    data('bye\r\n');
    report({ reason: 'ok', exitCode: 3, timeMs: 1500, error: null });
    exit(0);
    expect(await h.done).toMatchObject({
      reason: 'ok',
      exitCode: 3,
      timeMs: 1500,
      stdout: 'Menu> bye\r\n',
    });
    expect(seen).toEqual(['Menu> ', 'bye\r\n']);
  });

  it.each([
    ['time_limit', 10],
    ['memory_limit', 11],
    ['process_limit', 12],
  ] as const)('maps a %s report', async (reason, code) => {
    const h = ptyRun(spawnOf(), open, () => {});
    report({ reason, exitCode: null, timeMs: 5000, error: null });
    exit(code);
    expect((await h.done).reason).toBe(reason);
  });

  it('falls back to the exit code when there is no report', async () => {
    const h = ptyRun(spawnOf(), open, () => {});
    exit(11);
    expect((await h.done).reason).toBe('memory_limit');
  });

  it('kills the run at the output cap and keeps only what fits', async () => {
    const seen: string[] = [];
    const h = ptyRun(spawnOf({ outputCap: 10 }), open, (d) => seen.push(d));
    data('12345678');
    data('abcdef');
    data('ignored');
    const result = await h.done;
    expect(result.reason).toBe('output_limit');
    expect(result.stdout).toBe('12345678ab');
    expect(seen.join('')).toBe('12345678ab');
    expect(killed).toBe(1);
  });

  it('Stop kills the pty once and reports stopped', async () => {
    const h = ptyRun(spawnOf(), open, () => {});
    h.stop();
    h.stop();
    expect((await h.done).reason).toBe('stopped');
    expect(killed).toBe(1);
  });

  it('passes keystrokes through, until it was stopped', async () => {
    const h = ptyRun(spawnOf(), open, () => {});
    h.write('1\r');
    h.stop();
    h.write('2\r');
    await h.done;
    expect(written).toEqual(['1\r']);
  });

  it('reports a pty that cannot start', async () => {
    const h = ptyRun(
      spawnOf(),
      () => {
        throw new Error('no conpty');
      },
      () => {},
    );
    expect(await h.done).toMatchObject({ reason: 'failed', error: 'no conpty' });
  });
});

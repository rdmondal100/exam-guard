import { beforeEach, describe, expect, it } from 'vitest';
import type { PtyOpen } from '../terminal/pty.js';
import { ptyRun, type PtyRunSpawn } from './ptyRun.js';

let data: (d: string) => void;
let exit: (code: number) => void;
let killed: number;
let trees: number[];
let written: string[];

const PID = 4242;

const open: PtyOpen = () => ({
  pid: PID,
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
  command: 'main.exe',
  args: [],
  cwd: '.',
  env: {},
  outputCap: 100,
  timeMs: 60_000,
  size: { cols: 80, rows: 24 },
  killTree: (pid) => void trees.push(pid),
  ...over,
});

beforeEach(() => {
  killed = 0;
  trees = [];
  written = [];
});

describe('ptyRun', () => {
  it('returns what the program printed and its own exit code', async () => {
    const seen: string[] = [];
    const h = ptyRun(spawnOf(), open, (d) => seen.push(d));
    data('Menu> ');
    data('bye\r\n');
    exit(3);
    expect(await h.done).toMatchObject({ reason: 'ok', exitCode: 3, stdout: 'Menu> bye\r\n' });
    expect(seen).toEqual(['Menu> ', 'bye\r\n']);
    expect(trees).toEqual([]);
  });

  it('ends a program that runs past the time limit, with its whole tree', async () => {
    const h = ptyRun(spawnOf({ timeMs: 30 }), open, () => {});
    expect(await h.done).toMatchObject({ reason: 'time_limit', exitCode: null });
    expect(trees).toEqual([PID]);
    expect(killed).toBe(1);
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

  it('Stop kills the tree and the pty once and reports stopped', async () => {
    const h = ptyRun(spawnOf(), open, () => {});
    h.stop();
    h.stop();
    expect((await h.done).reason).toBe('stopped');
    expect(killed).toBe(1);
    expect(trees).toEqual([PID]);
  });

  it('reports the program it started and when it ended', async () => {
    const seen: (number | null)[] = [];
    const h = ptyRun(spawnOf({ onProcess: (pid) => seen.push(pid) }), open, () => {});
    exit(0);
    await h.done;
    expect(seen).toEqual([PID, null]);
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

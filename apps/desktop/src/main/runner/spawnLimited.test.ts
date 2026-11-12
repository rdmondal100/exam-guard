import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnLimited, type LimitedSpawn } from './spawnLimited.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-spawn-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Runs a Node one-liner as the program. */
const node = (code: string, over: Partial<LimitedSpawn> = {}) =>
  spawnLimited({
    command: process.execPath,
    args: ['-e', code],
    cwd: dir,
    env: process.env,
    stdin: '',
    outputCap: 1024,
    timeMs: 10_000,
    ...over,
  });

describe('spawnLimited', () => {
  it('feeds stdin and returns output and the exit code', async () => {
    const r = await node(
      "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log(s.toUpperCase());console.error('e');process.exit(3)})",
      { stdin: 'hi' },
    ).done;
    expect(r).toMatchObject({ reason: 'ok', exitCode: 3, stdout: 'HI\n', stderr: 'e\n' });
  });

  it('kills a program that prints past the cap and keeps exactly the cap', async () => {
    const r = await node("for(;;) process.stdout.write('x'.repeat(100))").done;
    expect(r.reason).toBe('output_limit');
    expect(r.stdout.length).toBe(1024);
  });

  it('stops on request and kills the whole tree', async () => {
    const trees: number[] = [];
    const handle = node('setInterval(() => {}, 1000)', { killTree: (pid) => trees.push(pid) });
    setTimeout(() => handle.stop(), 100);
    expect((await handle.done).reason).toBe('stopped');
    expect(trees).toHaveLength(1);
  });

  it('ends a program that runs past the time limit', async () => {
    const r = await node('setInterval(() => {}, 1000)', { timeMs: 200 }).done;
    expect(r).toMatchObject({ reason: 'time_limit', exitCode: null });
  });

  it('reports the process it started and when it ended', async () => {
    const seen: (number | null)[] = [];
    await node('process.exit(0)', { onProcess: (pid) => seen.push(pid) }).done;
    expect(seen).toHaveLength(2);
    expect(typeof seen[0]).toBe('number');
    expect(seen[1]).toBeNull();
  });

  it('reports a command that cannot start', async () => {
    const r = await spawnLimited({
      command: join(dir, 'missing.exe'),
      args: [],
      cwd: dir,
      env: process.env,
      stdin: '',
      outputCap: 10,
      timeMs: 1000,
    }).done;
    expect(r.reason).toBe('failed');
  });
});

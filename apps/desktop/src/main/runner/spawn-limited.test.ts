import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runnerArgs, spawnLimited, type LimitedSpawn } from './spawn-limited.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-spawn-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Runs a Node one-liner in place of eg-runner. */
const node = (code: string, over: Partial<LimitedSpawn> = {}) =>
  spawnLimited({
    command: process.execPath,
    args: ['-e', code],
    cwd: dir,
    env: process.env,
    stdin: '',
    outputCap: 1024,
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

  it('stops on request', async () => {
    const handle = node('setInterval(() => {}, 1000)');
    setTimeout(() => handle.stop(), 100);
    expect((await handle.done).reason).toBe('stopped');
  });

  it('reads the eg-runner report when there is one', async () => {
    const reportPath = join(dir, 'r.json');
    writeFileSync(
      reportPath,
      '{"reason":"time_limit","exitCode":1,"timeMs":5004,"peakMemMb":2,"error":null}',
    );
    const r = await node('process.exit(10)', { reportPath }).done;
    expect(r).toMatchObject({ reason: 'time_limit', exitCode: 1, timeMs: 5004 });
  });

  it('falls back to the eg-runner exit code without a report', async () => {
    const r = await node('process.exit(11)', { reportPath: join(dir, 'none.json') }).done;
    expect(r.reason).toBe('memory_limit');
    const odd = await node('process.exit(7)', { reportPath: join(dir, 'none.json') }).done;
    expect(odd.reason).toBe('failed');
  });

  it('reports a command that cannot start', async () => {
    const r = await spawnLimited({
      command: join(dir, 'missing.exe'),
      args: [],
      cwd: dir,
      env: process.env,
      stdin: '',
      outputCap: 10,
    }).done;
    expect(r.reason).toBe('failed');
  });
});

describe('runnerArgs', () => {
  it('puts the limits before -- and the program after', () => {
    expect(runnerArgs({ memMb: 256, timeMs: 5000, procs: 8 }, 'r.json', ['a.exe', '-x'])).toEqual([
      '--mem',
      '256',
      '--time',
      '5000',
      '--procs',
      '8',
      '--report',
      'r.json',
      '--',
      'a.exe',
      '-x',
    ]);
  });
});

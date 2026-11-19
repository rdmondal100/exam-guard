import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIN_FREE_BYTES, runSelfTest, type ExecResult } from './selfTest.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eg-selftest-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const tools = {
  mingwBin: 'C:\\mingw\\bin',
  nodeExe: 'C:\\app\\Student.exe',
  pythonExe: 'C:\\py\\python.exe',
};
const ok: ExecResult = { ok: true, stdout: 'ok\n', detail: '' };

describe('lobby self-test (M54)', () => {
  it('passes when every language prints ok and the disk has room', async () => {
    const calls: string[] = [];
    const report = await runSelfTest({
      tools,
      workDir: join(root, 'w'),
      env: { PATH: 'C:\\Windows' },
      exec: async (argv, _cwd, env) => {
        calls.push(argv[0] ?? '');
        expect(env.PATH?.startsWith('C:\\mingw\\bin')).toBe(true);
        return ok;
      },
      freeBytes: async () => MIN_FREE_BYTES * 2,
    });
    expect(report.checks.map((c) => [c.name, c.ok])).toEqual([
      ['c', true],
      ['cpp', true],
      ['python', true],
      ['js', true],
      ['disk', true],
    ]);
    // C and C++ compile, then run; Python and JavaScript only run.
    expect(calls).toHaveLength(6);
  });

  it('names what failed: a compiler error, a missing Python, a full disk', async () => {
    const report = await runSelfTest({
      tools: { ...tools, pythonExe: null },
      workDir: join(root, 'w'),
      env: {},
      exec: async (argv) =>
        argv[0]?.endsWith('g++.exe')
          ? { ok: false, stdout: '', detail: 'cc1plus.exe: fatal error' }
          : ok,
      freeBytes: async () => 100 * 1024 * 1024,
    });
    const failed = Object.fromEntries(
      report.checks.filter((c) => !c.ok).map((c) => [c.name, c.message]),
    );
    expect(failed).toEqual({
      cpp: 'cc1plus.exe: fatal error',
      python: 'Python is not installed on this computer.',
      disk: 'Only 100 MB free',
    });
  });

  it('fails C and C++ without the compiler, and a program that prints the wrong thing', async () => {
    const report = await runSelfTest({
      tools: { ...tools, mingwBin: null },
      workDir: join(root, 'w'),
      env: {},
      exec: async () => ({ ok: true, stdout: 'hello', detail: '' }),
      freeBytes: async () => MIN_FREE_BYTES,
    });
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));
    expect(byName.c?.message).toBe('The C/C++ compiler is missing.');
    expect(byName.cpp?.ok).toBe(false);
    expect(byName.python?.message).toBe('The program did not run.');
    expect(byName.disk?.ok).toBe(true);
  });
});

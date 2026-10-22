import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TERMINAL_LIMITS } from '@examguard/shared';
import type { Toolchain } from '../runner/toolchains.js';
import { PACMAN_CONF } from './shims.js';
import { prepareTerminal } from './terminal-launch.js';

let dir: string;
let tools: Toolchain;
const shell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-term-'));
  const msysRoot = join(dir, 'msys64');
  mkdirSync(join(msysRoot, 'etc', 'pacman.d', 'gnupg'), { recursive: true });
  writeFileSync(join(msysRoot, 'etc', 'pacman.d', 'gnupg', 'pubring.gpg'), 'keys');
  tools = {
    runner: 'C:\\eg-runner.exe',
    mingwBin: 'C:\\mingw64\\bin',
    nodeExe: 'C:\\ExamGuard.exe',
    msysRoot,
    npmCli: 'C:\\npm\\bin\\npm-cli.js',
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('prepareTerminal', () => {
  it('runs PowerShell inside eg-runner with the terminal limits in the workspace', () => {
    const run = join(dir, 'run', 'es1');
    const launch = prepareTerminal({
      runRoot: run,
      tools,
      baseEnv: { Path: 'C:\\Windows' },
      shell,
    });
    expect(launch.file).toBe('C:\\eg-runner.exe');
    expect(launch.args).toEqual([
      '--shell',
      '--mem',
      String(TERMINAL_LIMITS.memoryMb),
      '--time',
      '0',
      '--procs',
      String(TERMINAL_LIMITS.processes),
      '--',
      shell,
      '-NoLogo',
      '-NoProfile',
      '-NoExit',
      '-Command',
      `. '${join(run, '.examguard', 'init.ps1')}'`,
    ]);
    expect(launch.cwd).toBe(join(run, 'workspace'));
    expect(launch.nonce).toMatch(/^[0-9a-f]{24}$/);
    const script = readFileSync(join(run, '.examguard', 'init.ps1'), 'utf8');
    expect(script.charCodeAt(0)).toBe(0xfeff);
    expect(script).toContain(`]6973;${launch.nonce};`);
    expect(launch.env.PATH?.startsWith(join(run, '.examguard', 'bin'))).toBe(true);
  });

  it('writes the shims, pacman.conf, pacman folders and a keyring copy', () => {
    const run = join(dir, 'run', 'es1');
    prepareTerminal({ runRoot: run, tools, baseEnv: {}, shell });
    for (const name of ['node.cmd', 'npm.cmd', 'npx.cmd', 'pacman.cmd']) {
      expect(existsSync(join(run, '.examguard', 'bin', name))).toBe(true);
    }
    expect(readFileSync(join(run, '.examguard', 'pacman.conf'), 'utf8')).toBe(PACMAN_CONF);
    expect(readFileSync(join(run, '.examguard', 'gnupg', 'pubring.gpg'), 'utf8')).toBe('keys');
    expect(existsSync(join(run, 'workspace', '.msys', 'var', 'lib', 'pacman'))).toBe(true);
  });

  it('keeps the existing keyring copy and workspace on a second start', () => {
    const run = join(dir, 'run', 'es1');
    prepareTerminal({ runRoot: run, tools, baseEnv: {}, shell });
    writeFileSync(join(run, '.examguard', 'gnupg', 'pubring.gpg'), 'updated');
    writeFileSync(join(run, 'workspace', 'package.json'), '{}');
    prepareTerminal({ runRoot: run, tools, baseEnv: {}, shell });
    expect(readFileSync(join(run, '.examguard', 'gnupg', 'pubring.gpg'), 'utf8')).toBe('updated');
    expect(existsSync(join(run, 'workspace', 'package.json'))).toBe(true);
  });

  it('retries the keyring copy when an earlier one failed', () => {
    const run = join(dir, 'run', 'es3');
    const broken = { ...tools, msysRoot: join(dir, 'no-msys') };
    expect(() => prepareTerminal({ runRoot: run, tools: broken, baseEnv: {}, shell })).toThrow();
    expect(existsSync(join(run, '.examguard', 'gnupg'))).toBe(false);
    prepareTerminal({ runRoot: run, tools, baseEnv: {}, shell });
    expect(readFileSync(join(run, '.examguard', 'gnupg', 'pubring.gpg'), 'utf8')).toBe('keys');
  });

  it('works without MSYS2 and npm, and refuses without eg-runner', () => {
    const run = join(dir, 'run', 'es2');
    prepareTerminal({
      runRoot: run,
      tools: { ...tools, msysRoot: null, npmCli: null },
      baseEnv: {},
      shell,
    });
    expect(existsSync(join(run, '.examguard', 'bin', 'pacman.cmd'))).toBe(false);
    expect(existsSync(join(run, '.examguard', 'gnupg'))).toBe(false);
    expect(() =>
      prepareTerminal({ runRoot: run, tools: { ...tools, runner: null }, baseEnv: {}, shell }),
    ).toThrow(/not installed/);
  });
});

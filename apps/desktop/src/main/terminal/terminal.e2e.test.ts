import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { TerminalExit } from '@examguard/shared';
import { resolveToolchain } from '../runner/toolchains.js';
import { spawnPty } from './pty.js';
import { TerminalHost } from './terminal-host.js';
import { prepareTerminal } from './terminal-launch.js';

// Real node-pty (ConPTY), eg-runner (`cargo build -p eg-runner`) and PowerShell. Skipped when
// eg-runner is missing. Node stands in for Electron-as-Node behind the node shim.
const tools = resolveToolchain({
  isPackaged: false,
  appPath: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
  resourcesPath: '',
  execPath: process.execPath,
  env: process.env,
});
const root = mkdtempSync(join(tmpdir(), 'eg-term e2e-')); // a space, like real profiles
afterAll(() => rmSync(root, { recursive: true, force: true }));
const shell = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);

// ConPTY output is full of escape sequences (titles, colours, cursor moves).
const plain = (s: string) =>
  // eslint-disable-next-line no-control-regex -- matching those escapes is the point
  s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
const alive = (pid: number) =>
  execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' }).includes(
    String(pid),
  );

let output = '';
let exits: TerminalExit[] = [];
let host: TerminalHost;

const start = () => {
  output = '';
  // Per host: the previous test's shell reports its exit after this test has started.
  const mine: TerminalExit[] = [];
  exits = mine;
  host = new TerminalHost({
    spawn: spawnPty,
    onData: (d) => {
      if (exits === mine) output += d;
    },
    onExit: (e) => mine.push(e),
    flushMs: 5,
  });
  host.open(() => prepareTerminal({ runRoot: root, tools, baseEnv: process.env, shell }), {
    cols: 200,
    rows: 40,
  });
};
const waitFor = async (pattern: RegExp, ms = 20_000): Promise<RegExpMatchArray> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const m = plain(output).match(pattern);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${pattern} in:\n${plain(output).slice(-2000)}`);
};
// The typed command is echoed too, so markers are computed: `"m" + (6*7)` prints m42.
const run = async (command: string, marker: string) => {
  host.write(`${command ? `${command}; ` : ''}"${marker}" + (6*7)\r`);
  await waitFor(new RegExp(`${marker}42`));
};

afterEach(() => host?.close());

describe.skipIf(!tools.runner)('exam terminal with node-pty and eg-runner', () => {
  it('runs commands in the workspace', async () => {
    start();
    await run('(Get-Location).Path', 'cwd');
    expect(plain(output)).toContain(join(root, 'workspace'));
  }, 30_000);

  it('Ctrl+C stops the command, not the shell', async () => {
    start();
    await run('', 'ready');
    host.write('ping -t 127.0.0.1\r');
    await waitFor(/Reply from 127\.0\.0\.1/);
    host.write('\x03');
    // Ctrl+C clears the console input buffer, so type only once the prompt is back.
    await waitFor(/Control-C\s+PS [^\n]*> $/);
    await run('', 'after');
    expect(host.isOpen).toBe(true);
    expect(exits).toEqual([]);
  }, 30_000);

  it('closing kills everything started from the shell', async () => {
    start();
    host.write(
      `$p = Start-Process ping -ArgumentList '-t','127.0.0.1' -NoNewWindow -PassThru; "PID=" + ($p.Id + 0) + "!"\r`,
    );
    const pid = Number((await waitFor(/PID=(\d+)!/))[1]);
    expect(alive(pid)).toBe(true);
    host.close();
    const until = Date.now() + 3_000;
    while (alive(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    expect(alive(pid)).toBe(false);
    while (exits.length === 0 && Date.now() < until + 3_000)
      await new Promise((r) => setTimeout(r, 50));
    expect(exits).toEqual([expect.objectContaining({ reason: 'closed' })]);
  }, 30_000);

  it('node and npm run through the shims', async () => {
    start();
    await run(`node -e "console.log('shim=' + process.env.ELECTRON_RUN_AS_NODE + '!')"`, 'node');
    expect(plain(output)).toContain('shim=1!');
    if (tools.npmCli) {
      output = '';
      await run('npm -v', 'npm');
      expect(plain(output)).toMatch(/^\s*\d+\.\d+\.\d+\s*$/m);
    }
  }, 60_000);
});

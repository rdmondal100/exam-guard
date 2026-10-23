import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAgentExe } from './agent-exe.js';
import { installAgent, uninstallAgent } from './agent-installer.js';
import type { RunCommand } from './run-command.js';
import { parseScQuery } from './service-state.js';
import { INSTALL_SCRIPT } from './setup-scripts.js';
import { lastEvents, shortenLogLine } from './spike-report.js';

describe('parseScQuery', () => {
  const query = (n: string, word: string) =>
    `SERVICE_NAME: X\n        STATE              : ${n}  ${word}\n`;
  it('reads the state number, not the word', () => {
    expect(parseScQuery(query('4', 'RUNNING'), 0)).toBe('running');
    expect(parseScQuery(query('4', 'AUSGEFÜHRT'), 0)).toBe('running');
    expect(parseScQuery(query('1', 'STOPPED'), 0)).toBe('stopped');
    expect(parseScQuery(query('2', 'START_PENDING'), 0)).toBe('unknown');
  });
  it('maps error 1060 to missing and junk to unknown', () => {
    expect(parseScQuery('[SC] EnumQueryServicesStatus:OpenService FAILED 1060', 1060)).toBe(
      'missing',
    );
    expect(parseScQuery('', -1)).toBe('unknown');
  });
});

describe('resolveAgentExe', () => {
  const base = { appPath: 'C:\\repo\\apps\\desktop', resourcesPath: 'C:\\app\\resources' };
  it('prefers the override, then release, then debug in dev', () => {
    const exists = (p: string) => p.endsWith('eg-agent.exe');
    expect(
      resolveAgentExe({
        ...base,
        isPackaged: false,
        env: { EG_AGENT_PATH: 'D:\\x\\eg-agent.exe' },
        exists,
      }),
    ).toBe('D:\\x\\eg-agent.exe');
    expect(resolveAgentExe({ ...base, isPackaged: false, env: {}, exists })).toMatch(/release/);
    expect(
      resolveAgentExe({ ...base, isPackaged: false, env: {}, exists: (p) => p.includes('debug') }),
    ).toMatch(/debug/);
  });
  it('ignores the override when packaged', () => {
    const env = { EG_AGENT_PATH: 'D:\\x\\eg-agent.exe' };
    expect(resolveAgentExe({ ...base, isPackaged: true, env, exists: () => true })).toBe(
      join('C:\\app\\resources', 'eg-agent.exe'),
    );
    expect(resolveAgentExe({ ...base, isPackaged: true, env, exists: () => false })).toBeNull();
  });
});

describe('installer', () => {
  /** A stand-in for the elevated PowerShell: writes `result` where the script would. */
  async function fakeRun(result: string | null, seen: string[][]): Promise<RunCommand> {
    return async (_file, args) => {
      seen.push(args);
      if (result !== null) {
        const command = args[args.length - 1] ?? '';
        const path = /"([^"]*agent-setup\.result)"/.exec(command)?.[1];
        if (path) await writeFile(path, result);
      }
      return { stdout: '', code: 0 };
    };
  }

  it('reports success when the script wrote ok', async () => {
    const seen: string[][] = [];
    const workDir = await mkdtemp(join(tmpdir(), 'eg-setup-'));
    const run = await fakeRun('ok\r\n', seen);
    expect(await installAgent('C:\\Dev Path\\eg-agent.exe', { run, workDir })).toBeNull();
    const command = seen[0]?.at(-1) ?? '';
    expect(command).toContain('-Verb RunAs');
    expect(command).toContain('"C:\\Dev Path\\eg-agent.exe"');
    expect(await readFile(join(workDir, 'agent-setup.ps1'), 'utf8')).toBe(INSTALL_SCRIPT);
  });

  it('returns the script error text', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'eg-setup-'));
    const run = await fakeRun('eg-agent --install failed: Access denied', []);
    expect(await uninstallAgent({ run, workDir })).toBe('eg-agent --install failed: Access denied');
  });

  it('says approval was declined when no result file appears', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'eg-setup-'));
    const run = await fakeRun(null, []);
    expect(await installAgent('C:\\a.exe', { run, workDir })).toMatch(/declined/);
  });
});

describe('spike report', () => {
  const log = [
    '2026-10-23T14:39:14.694726Z  INFO eg_agent::helper: helper started pid=4648 user=SYSTEM',
    '2026-10-23T14:39:14.920210Z  INFO eg_agent::helper: foreground pid=7 exe=C:\\chrome.exe title=Tab',
    '2026-10-23T14:39:15.000000Z  INFO eg_agent::helper: foreground hook installed',
    'noise',
  ].join('\n');

  it('shortens a tracing line', () => {
    expect(shortenLogLine(log.split('\n')[1] ?? '')).toBe(
      '14:39:14Z foreground pid=7 exe=C:\\chrome.exe title=Tab',
    );
    expect(shortenLogLine('noise')).toBe('noise');
  });
  it('keeps the interesting lines, newest last, at most 8', () => {
    expect(lastEvents(log)).toHaveLength(3);
    const many = Array.from(
      { length: 20 },
      (_, i) => `2026-10-23T14:00:${String(i).padStart(2, '0')}Z  INFO a::b: foreground n=${i}`,
    );
    const out = lastEvents(many.join('\n'));
    expect(out).toHaveLength(8);
    expect(out.at(-1)).toContain('n=19');
  });
});

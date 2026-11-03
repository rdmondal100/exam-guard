// The installer and the app must agree on paths and registry keys: electron-builder.config.ts
// places the files, build/installer.nsh writes the registry, main and the agent read both.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builderConfig, PACKED_RESOURCES } from '../../electron-builder.config';
import { resolveAgentExe } from './agent/agent-exe.js';
import { INSTALL_REG_KEY } from './install-type.js';
import { resolveToolchain } from './runner/toolchains.js';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const repo = resolve(desktop, '..', '..');
const config = builderConfig({
  repo,
  desktop,
  output: join(repo, 'release'),
  electronVersion: '44.0.0',
  electronDist: join(desktop, 'node_modules/electron/dist'),
});
const nsh = readFileSync(join(desktop, 'build/installer.nsh'), 'utf8');

function nshDefine(name: string): string {
  const match = new RegExp(`^!define ${name} "(.+)"$`, 'm').exec(nsh);
  if (!match?.[1]) throw new Error(`${name} is not defined in installer.nsh`);
  return match[1];
}

describe('packaged layout', () => {
  const R = 'C:\\EG\\resources';

  it('puts the agent, the runner and the toolchains where main looks for them', () => {
    const targets = (config.extraResources as { to: string }[]).map((r) => r.to);
    expect(targets).toEqual([
      PACKED_RESOURCES.agent,
      PACKED_RESOURCES.runner,
      PACKED_RESOURCES.toolchains,
    ]);
    const exists = () => true;
    const env = { isPackaged: true, appPath: 'unused', resourcesPath: R, env: {}, exists };
    expect(resolveAgentExe(env)).toBe(join(R, PACKED_RESOURCES.agent));
    const tools = resolveToolchain({ ...env, execPath: 'C:\\EG\\ExamGuard.exe' });
    expect(tools.runner).toBe(join(R, PACKED_RESOURCES.runner));
    expect(tools.msysRoot).toBe(join(R, PACKED_RESOURCES.toolchains, 'msys64'));
    expect(tools.pythonExe).toBe(join(R, PACKED_RESOURCES.toolchains, 'python', 'python.exe'));
  });

  it('keeps native modules out of the asar and RunAsNode on for student JavaScript', () => {
    expect(config.asarUnpack).toEqual(
      expect.arrayContaining(['**/node_modules/node-pty/**', '**/node_modules/better-sqlite3/**']),
    );
    expect(config.electronFuses?.runAsNode).toBe(true);
    expect(config.electronFuses?.enableNodeOptionsEnvironmentVariable).toBe(false);
    expect(config.electronFuses?.enableNodeCliInspectArguments).toBe(false);
  });

  it('installs per machine with the ExamGuard userData name', () => {
    expect(config.nsis?.perMachine).toBe(true);
    expect(config.nsis?.include).toBe(join(desktop, 'build/installer.nsh'));
    expect(config.extraMetadata).toMatchObject({ productName: 'ExamGuard' });
  });
});

describe('installer.nsh', () => {
  it('writes InstallType under the key the app reads', () => {
    expect(`HKLM\\${nshDefine('EG_REG_KEY')}`.toLowerCase()).toBe(INSTALL_REG_KEY.toLowerCase());
    expect(nsh).toContain('WriteRegStr HKLM "${EG_REG_KEY}" "InstallType" "$egInstallType"');
  });

  it("writes AppPath under the agent's key and runs the packed agent", () => {
    const agentSource = readFileSync(join(repo, 'agent/eg-agent/src/pipe_security.rs'), 'utf8');
    const agentKey = /const KEY: &str = r"(.+)";/.exec(agentSource)?.[1];
    expect(agentKey?.toLowerCase()).toBe(nshDefine('EG_REG_KEY').toLowerCase());
    expect(nsh).toContain('WriteRegStr HKLM "${EG_REG_KEY}" "AppPath"');
    expect(nshDefine('EG_AGENT_EXE')).toBe(`$INSTDIR\\resources\\${PACKED_RESOURCES.agent}`);
  });

  it('accepts only the two install types on the command line', () => {
    expect(nsh).toContain('${GetOptions} $R0 "/TYPE=" $R1');
    expect(nsh.match(/StrCpy \$egInstallType "(\w+)"/g)).toEqual(
      expect.arrayContaining([
        'StrCpy $egInstallType "student"',
        'StrCpy $egInstallType "teacher"',
      ]),
    );
  });
});

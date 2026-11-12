// The installer and the app must agree on paths and registry keys: electron-builder.config.ts
// places the files, resources/installer.nsh writes the registry, and main reads both.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builderConfig, PACKED_RESOURCES } from '../../electron-builder.config';
import { INSTALL_REG_KEY } from './mode/installType.js';
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
const nsh = readFileSync(join(desktop, 'resources/installer.nsh'), 'utf8');

function nshDefine(name: string): string {
  const match = new RegExp(`^!define ${name} "(.+)"$`, 'm').exec(nsh);
  if (!match?.[1]) throw new Error(`${name} is not defined in installer.nsh`);
  return match[1];
}

describe('packaged layout', () => {
  const R = 'C:\\EG\\resources';

  it('puts SiteReader and the toolchains where main looks for them', () => {
    const targets = (config.extraResources as { to: string }[]).map((r) => r.to);
    expect(targets).toEqual([PACKED_RESOURCES.siteReader, PACKED_RESOURCES.toolchains]);
    const exists = () => true;
    const env = { isPackaged: true, appPath: 'unused', resourcesPath: R, env: {}, exists };
    const tools = resolveToolchain({ ...env, execPath: 'C:\\EG\\ExamGuard.exe' });
    expect(tools.msysRoot).toBe(join(R, PACKED_RESOURCES.toolchains, 'msys64'));
    expect(tools.pythonExe).toBe(join(R, PACKED_RESOURCES.toolchains, 'python', 'python.exe'));
  });

  it('ships no Rust agent or runner any more', () => {
    const sources = (config.extraResources as { from: string }[]).map((r) => r.from);
    expect(sources.some((s) => /eg-(agent|runner)|target[\\/]release/.test(s))).toBe(false);
  });

  it('keeps native modules out of the asar and RunAsNode on for student JavaScript', () => {
    expect(config.asarUnpack).toEqual(
      expect.arrayContaining([
        '**/node_modules/node-pty/**',
        '**/node_modules/better-sqlite3/**',
        '**/node_modules/get-windows/**',
      ]),
    );
    expect(config.electronFuses?.runAsNode).toBe(true);
    expect(config.electronFuses?.enableNodeOptionsEnvironmentVariable).toBe(false);
    expect(config.electronFuses?.enableNodeCliInspectArguments).toBe(false);
  });

  it('installs per machine with the ExamGuard userData name', () => {
    expect(config.nsis?.perMachine).toBe(true);
    expect(config.nsis?.include).toBe(join(desktop, 'resources/installer.nsh'));
    expect(config.extraMetadata).toMatchObject({ productName: 'ExamGuard' });
  });
});

describe('installer.nsh', () => {
  it('writes InstallType under the key the app reads', () => {
    expect(`HKLM\\${nshDefine('EG_REG_KEY')}`.toLowerCase()).toBe(INSTALL_REG_KEY.toLowerCase());
    expect(nsh).toContain('WriteRegStr HKLM "${EG_REG_KEY}" "InstallType" "$egInstallType"');
  });

  it('installs no service and removes the old agent service an earlier version left', () => {
    expect(nsh).not.toMatch(/--install|eg-agent\.exe/);
    expect(nshDefine('EG_OLD_SERVICE')).toBe('ExamGuardAgent');
    expect(nsh).toContain('sc.exe delete "${EG_OLD_SERVICE}"');
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

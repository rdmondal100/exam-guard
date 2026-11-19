// The installers and the apps must agree on paths and contents: electron-builder.config.ts places
// the files per app (M52), resources/{teacher,student}.nsh do the install steps, main reads both.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  builderConfig,
  FLAVORS,
  keepClosure,
  PACKED_RESOURCES,
} from '../../electron-builder.config';
import { resolveToolchain } from './runner/toolchains.js';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const repo = resolve(desktop, '..', '..');
const paths = {
  repo,
  desktop,
  output: join(repo, 'release'),
  electronVersion: '44.0.0',
  electronDist: join(desktop, 'node_modules/electron/dist'),
};
const teacher = builderConfig(paths, 'teacher');
const student = builderConfig(paths, 'student');
const nsh = (name: string) => readFileSync(join(desktop, `resources/${name}.nsh`), 'utf8');

describe('student app layout', () => {
  const R = 'C:\\EG\\resources';

  it('puts SiteReader and the toolchains where main looks for them', () => {
    const targets = (student.extraResources as { to: string }[]).map((r) => r.to);
    expect(targets).toEqual([PACKED_RESOURCES.siteReader, PACKED_RESOURCES.toolchains]);
    const exists = () => true;
    const env = { isPackaged: true, appPath: 'unused', resourcesPath: R, env: {}, exists };
    const tools = resolveToolchain({ ...env, execPath: 'C:\\EG\\ExamGuardStudent.exe' });
    expect(tools.msysRoot).toBe(join(R, PACKED_RESOURCES.toolchains, 'msys64'));
    expect(tools.pythonExe).toBe(join(R, PACKED_RESOURCES.toolchains, 'python', 'python.exe'));
  });

  it('keeps node-pty and get-windows out of the asar, RunAsNode on for student JavaScript', () => {
    expect(student.asarUnpack).toEqual([
      '**/node_modules/node-pty/**',
      '**/node_modules/get-windows/**',
    ]);
    expect(student.electronFuses?.runAsNode).toBe(true);
    expect(student.electronFuses?.enableNodeOptionsEnvironmentVariable).toBe(false);
  });

  it('ships without the exam server', () => {
    expect(FLAVORS.student.dropDependencies).toContain('@examguard/server');
    expect(student.extraMetadata).toMatchObject({ productName: 'ExamGuard Student' });
  });
});

describe('teacher app layout', () => {
  it('ships no toolchains, SiteReader, node-pty or get-windows', () => {
    expect(teacher.extraResources).toEqual([]);
    expect(FLAVORS.teacher.dropDependencies).toEqual(['node-pty', 'get-windows']);
    expect(teacher.asarUnpack).toEqual(['**/node_modules/better-sqlite3/**']);
  });

  it('turns RunAsNode off and keeps the pre-M52 userData name', () => {
    expect(teacher.electronFuses?.runAsNode).toBe(false);
    expect(teacher.extraMetadata).toMatchObject({ productName: 'ExamGuard' });
  });
});

describe('both installers', () => {
  it('install per machine with their own app id, exe and include', () => {
    for (const [app, config] of [
      ['teacher', teacher],
      ['student', student],
    ] as const) {
      expect(config.nsis?.perMachine).toBe(true);
      expect(config.nsis?.include).toBe(join(desktop, `resources/${app}.nsh`));
      expect(config.appId).toBe(`ai.examguard.${app}`);
    }
    expect(teacher.win?.executableName).not.toBe(student.win?.executableName);
  });

  it('have no install-type page or /TYPE switch any more', () => {
    for (const name of ['teacher', 'student']) {
      expect(nsh(name)).not.toMatch(/\/TYPE=|InstallType|customWelcomePage/);
    }
  });

  it('add firewall rules only for the teacher', () => {
    expect(nsh('teacher')).toContain('netsh advfirewall firewall add rule');
    expect(nsh('student')).not.toContain('advfirewall');
  });

  it('remove the old agent service on student PCs and install no service', () => {
    const s = nsh('student');
    expect(s).not.toMatch(/--install|eg-agent\.exe/);
    expect(s).toContain('sc.exe delete "${EG_OLD_SERVICE}"');
  });
});

describe('keepClosure (pruning the packaged dependencies)', () => {
  // root → a → c; root → b (dropped) → d; a has its own nested c? no: c is shared.
  const deps: Record<string, string[]> = {
    '/s/node_modules/a': ['c'],
    '/s/node_modules/b': ['d'],
    '/s/node_modules/c': [],
    '/s/node_modules/d': [],
  };
  const resolveFrom = (_from: string, name: string) =>
    deps[`/s/node_modules/${name}`] ? `/s/node_modules/${name}` : null;

  it('keeps what the remaining roots need and nothing that only a dropped root used', () => {
    const keep = keepClosure('/s', ['a'], (dir) => deps[dir] ?? [], resolveFrom);
    expect([...keep].sort()).toEqual(['/s/node_modules/a', '/s/node_modules/c']);
  });

  it('skips dependencies that are not installed', () => {
    const keep = keepClosure('/s', ['a', 'missing'], (dir) => deps[dir] ?? [], resolveFrom);
    expect(keep.has('/s/node_modules/missing')).toBe(false);
  });
});

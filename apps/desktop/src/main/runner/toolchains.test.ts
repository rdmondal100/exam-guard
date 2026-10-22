import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveToolchain, type ToolchainEnv } from './toolchains.js';

const APP = resolve('/repo/apps/desktop');
const base = (files: string[], over: Partial<ToolchainEnv> = {}): ToolchainEnv => ({
  isPackaged: false,
  appPath: APP,
  resourcesPath: resolve('/res'),
  execPath: 'electron.exe',
  env: {},
  exists: (p) => files.includes(p),
  ...over,
});

const debugRunner = resolve('/repo/target/debug/eg-runner.exe');
const releaseRunner = resolve('/repo/target/release/eg-runner.exe');
const devGcc = join(APP, 'resources/toolchains/mingw64/bin/gcc.exe');
const devPacman = join(APP, 'resources/toolchains/msys64/usr/bin/pacman.exe');
const devNpm = join(APP, 'resources/toolchains/npm/bin/npm-cli.js');
const devPython = join(APP, 'resources/toolchains/python/python.exe');

describe('resolveToolchain', () => {
  it('finds the dev runner (release first) and the fetched MinGW', () => {
    const t = resolveToolchain(base([debugRunner, releaseRunner, devGcc]));
    expect(t.runner).toBe(releaseRunner);
    expect(t.mingwBin).toBe(join(APP, 'resources/toolchains/mingw64/bin'));
    expect(t.nodeExe).toBe('electron.exe');
  });

  it('finds MSYS2, npm and Python for the terminal and Run', () => {
    const t = resolveToolchain(base([devPacman, devNpm, devPython]));
    expect(t.pythonExe).toBe(devPython);
    expect(t.msysRoot).toBe(join(APP, 'resources/toolchains/msys64'));
    expect(t.npmCli).toBe(devNpm);
  });

  it('reports what is missing as null', () => {
    expect(resolveToolchain(base([]))).toMatchObject({
      runner: null,
      mingwBin: null,
      msysRoot: null,
      npmCli: null,
      pythonExe: null,
    });
  });

  it('honours the dev overrides', () => {
    const gcc = resolve('/mingw/bin/gcc.exe');
    const t = resolveToolchain(
      base(['/r.exe', gcc], { env: { EG_RUNNER_PATH: '/r.exe', EG_MINGW_DIR: resolve('/mingw') } }),
    );
    expect(t).toMatchObject({ runner: '/r.exe', mingwBin: resolve('/mingw/bin') });
  });

  it('ignores the overrides when packaged', () => {
    const runner = join(resolve('/res'), 'eg-runner.exe');
    const npm = join(resolve('/res'), 'toolchains/npm/bin/npm-cli.js');
    const t = resolveToolchain(
      base([runner, '/r.exe', npm], { isPackaged: true, env: { EG_RUNNER_PATH: '/r.exe' } }),
    );
    expect(t).toMatchObject({ runner, mingwBin: null, npmCli: npm });
  });
});

import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveToolchain, toolchainsDir, type ToolchainEnv } from './toolchains.js';

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

const devGcc = join(APP, 'resources/toolchains/mingw64/bin/gcc.exe');
const devPacman = join(APP, 'resources/toolchains/msys64/usr/bin/pacman.exe');
const devNpm = join(APP, 'resources/toolchains/npm/bin/npm-cli.js');
const devPython = join(APP, 'resources/toolchains/python/python.exe');

describe('resolveToolchain', () => {
  it('finds the fetched MinGW and runs JavaScript on Electron itself', () => {
    const t = resolveToolchain(base([devGcc]));
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
      mingwBin: null,
      msysRoot: null,
      npmCli: null,
      pythonExe: null,
    });
  });

  it('honours the dev MinGW override', () => {
    const gcc = resolve('/mingw/bin/gcc.exe');
    const t = resolveToolchain(base([gcc], { env: { EG_MINGW_DIR: resolve('/mingw') } }));
    expect(t.mingwBin).toBe(resolve('/mingw/bin'));
  });

  it('ignores the override when packaged', () => {
    const npm = join(resolve('/res'), 'toolchains/npm/bin/npm-cli.js');
    const gcc = resolve('/mingw/bin/gcc.exe');
    const t = resolveToolchain(
      base([gcc, npm], { isPackaged: true, env: { EG_MINGW_DIR: resolve('/mingw') } }),
    );
    expect(t).toMatchObject({ mingwBin: null, npmCli: npm });
  });

  it('names the toolchains folder in dev and once installed', () => {
    expect(toolchainsDir(base([]))).toBe(join(APP, 'resources', 'toolchains'));
    expect(toolchainsDir(base([], { isPackaged: true }))).toBe(join(resolve('/res'), 'toolchains'));
  });
});

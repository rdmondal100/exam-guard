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

describe('resolveToolchain', () => {
  it('finds the dev runner (release first) and the fetched MinGW', () => {
    const t = resolveToolchain(base([debugRunner, releaseRunner, devGcc]));
    expect(t.runner).toBe(releaseRunner);
    expect(t.mingwBin).toBe(join(APP, 'resources/toolchains/mingw64/bin'));
    expect(t.nodeExe).toBe('electron.exe');
  });

  it('reports what is missing as null', () => {
    expect(resolveToolchain(base([]))).toMatchObject({ runner: null, mingwBin: null });
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
    const t = resolveToolchain(
      base([runner, '/r.exe'], { isPackaged: true, env: { EG_RUNNER_PATH: '/r.exe' } }),
    );
    expect(t).toMatchObject({ runner, mingwBin: null });
  });
});

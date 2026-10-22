import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ToolPaths } from './languages.js';

export interface Toolchain extends ToolPaths {
  /** `eg-runner.exe`, or `null` if it was not found. */
  runner: string | null;
  /** MSYS2 root (for `pacman` in the exam terminal), or `null` if it was not found. */
  msysRoot: string | null;
  /** npm's `bin/npm-cli.js`, run on Electron as Node, or `null` if it was not found. */
  npmCli: string | null;
}

export interface ToolchainEnv {
  isPackaged: boolean;
  /** `app.getAppPath()`: `apps/desktop` in dev. */
  appPath: string;
  /** `process.resourcesPath` of a packaged app. */
  resourcesPath: string;
  execPath: string;
  env: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

/**
 * Finds eg-runner and the toolchains. Dev: the Cargo `target` folder and `resources/toolchains`
 * from `pnpm fetch-toolchains`, with `EG_RUNNER_PATH` and `EG_MINGW_DIR` as overrides. Packaged:
 * next to the app resources (final layout in M45); the overrides are ignored there.
 */
export function resolveToolchain(t: ToolchainEnv): Toolchain {
  const exists = t.exists ?? existsSync;
  const first = (paths: (string | undefined)[]) =>
    paths.find((p): p is string => !!p && exists(p)) ?? null;
  const tools = (toolchains: string, mingwRoot: string) => {
    const mingw = join(mingwRoot, 'bin');
    const msys = join(toolchains, 'msys64');
    return {
      mingwBin: first([join(mingw, 'gcc.exe')]) && mingw,
      msysRoot: first([join(msys, 'usr', 'bin', 'pacman.exe')]) && msys,
      npmCli: first([join(toolchains, 'npm', 'bin', 'npm-cli.js')]),
      pythonExe: first([join(toolchains, 'python', 'python.exe')]),
      nodeExe: t.execPath,
    };
  };

  if (t.isPackaged) {
    const toolchains = join(t.resourcesPath, 'toolchains');
    return {
      runner: first([join(t.resourcesPath, 'eg-runner.exe')]),
      ...tools(toolchains, join(toolchains, 'mingw64')),
    };
  }
  const repo = resolve(t.appPath, '..', '..');
  const toolchains = join(t.appPath, 'resources', 'toolchains');
  return {
    runner: first([
      t.env.EG_RUNNER_PATH,
      join(repo, 'target', 'release', 'eg-runner.exe'),
      join(repo, 'target', 'debug', 'eg-runner.exe'),
    ]),
    ...tools(toolchains, t.env.EG_MINGW_DIR || join(toolchains, 'mingw64')),
  };
}

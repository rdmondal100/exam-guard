import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ToolPaths } from './languages.js';

export interface Toolchain extends ToolPaths {
  /** `eg-runner.exe`, or `null` if it was not found. */
  runner: string | null;
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
 * Finds eg-runner and MinGW. Dev: the Cargo `target` folder and `resources/toolchains` from
 * `pnpm fetch-toolchains`, overridable with `EG_RUNNER_PATH` and `EG_MINGW_DIR`. Packaged: next
 * to the app resources (final layout in M45); the overrides are ignored there.
 */
export function resolveToolchain(t: ToolchainEnv): Toolchain {
  const exists = t.exists ?? existsSync;
  const first = (paths: (string | undefined)[]) =>
    paths.find((p): p is string => !!p && exists(p)) ?? null;

  if (t.isPackaged) {
    const mingw = join(t.resourcesPath, 'toolchains', 'mingw64', 'bin');
    return {
      runner: first([join(t.resourcesPath, 'eg-runner.exe')]),
      mingwBin: first([join(mingw, 'gcc.exe')]) && mingw,
      nodeExe: t.execPath,
    };
  }
  const repo = resolve(t.appPath, '..', '..');
  const mingwRoot = t.env.EG_MINGW_DIR || join(t.appPath, 'resources', 'toolchains', 'mingw64');
  const mingw = join(mingwRoot, 'bin');
  return {
    runner: first([
      t.env.EG_RUNNER_PATH,
      join(repo, 'target', 'release', 'eg-runner.exe'),
      join(repo, 'target', 'debug', 'eg-runner.exe'),
    ]),
    mingwBin: first([join(mingw, 'gcc.exe')]) && mingw,
    nodeExe: t.execPath,
  };
}

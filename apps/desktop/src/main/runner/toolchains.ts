import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ToolPaths } from './languages.js';

export interface Toolchain extends ToolPaths {
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
 * Finds the toolchains. Dev: `resources/toolchains` from `pnpm fetch-toolchains`, with
 * `EG_MINGW_DIR` as an override. Packaged: next to the app resources (`electron-builder.config.ts`);
 * the override is ignored there.
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

  const toolchains = toolchainsDir(t);
  if (t.isPackaged) return tools(toolchains, join(toolchains, 'mingw64'));
  return tools(toolchains, t.env.EG_MINGW_DIR || join(toolchains, 'mingw64'));
}

/** Where the bundled toolchains live: the monitor counts their programs as the student's own. */
export function toolchainsDir(t: Pick<ToolchainEnv, 'isPackaged' | 'appPath' | 'resourcesPath'>) {
  return t.isPackaged
    ? join(t.resourcesPath, 'toolchains')
    : resolve(t.appPath, 'resources', 'toolchains');
}

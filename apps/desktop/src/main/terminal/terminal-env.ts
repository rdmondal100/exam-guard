import { join } from 'node:path';

/** Folders of one student's exam terminal under the run root (architecture §4). */
export interface TerminalPaths {
  /** The shell's cwd; installed packages stay here between runs. */
  workspace: string;
  /** pacman's `--root` for MSYS2 packages (`ucrt64/{bin,include,lib}`). */
  msysOverlay: string;
  /** ExamGuard's own files, outside the workspace: shims, pacman.conf, keyring copy. */
  support: string;
  shims: string;
}

export function terminalPaths(runRoot: string): TerminalPaths {
  const workspace = join(runRoot, 'workspace');
  const support = join(runRoot, '.examguard');
  return {
    workspace,
    msysOverlay: join(workspace, '.msys'),
    support,
    shims: join(support, 'bin'),
  };
}

export interface TerminalEnvInput {
  /** Electron main's environment. */
  base: NodeJS.ProcessEnv;
  paths: TerminalPaths;
  /** MinGW `bin`, or `null` if C/C++ is not installed. */
  mingwBin: string | null;
}

/** Variables that belong to ExamGuard itself and must not leak into the student's shell. */
const PRIVATE = /^(ELECTRON_|EG_|VITE_)/i;

/**
 * The shell's environment. PATH puts the shims (node, npm, npx, pacman) first, then gcc, then
 * what the student installed, then the system PATH. gcc reads the include/lib variables, so
 * `gcc cube.c -lfreeglut` works after `pacman -S` without extra flags.
 */
export function terminalEnv({ base, paths, mingwBin }: TerminalEnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  let systemPath = '';
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || PRIVATE.test(key)) continue;
    // Windows keeps one PATH under any casing ("Path"); keep a single upper-case key.
    if (key.toUpperCase() === 'PATH') systemPath = value;
    else env[key] = value;
  }
  const ucrt = join(paths.msysOverlay, 'ucrt64');
  env.PATH = [
    paths.shims,
    mingwBin,
    join(ucrt, 'bin'),
    join(paths.workspace, 'node_modules', '.bin'),
    systemPath,
  ]
    .filter((p): p is string => !!p)
    .join(';');
  env.C_INCLUDE_PATH = join(ucrt, 'include');
  env.CPLUS_INCLUDE_PATH = join(ucrt, 'include');
  env.LIBRARY_PATH = join(ucrt, 'lib');
  env.npm_config_update_notifier = 'false';
  env.npm_config_fund = 'false';
  return env;
}

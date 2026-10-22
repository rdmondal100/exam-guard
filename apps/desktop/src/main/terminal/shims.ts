import { join } from 'node:path';
import type { TerminalPaths } from './terminal-env.js';

/**
 * MSYS2 programs take POSIX paths: gpg treats `C:/x` as relative, so pacman gets `/c/x`.
 * MSYS2 mounts every drive as `/<letter>`.
 */
export function toMsysPath(windowsPath: string): string {
  return windowsPath
    .split('\\')
    .join('/')
    .replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`);
}

/** A path inside a double-quoted batch argument: `%` would expand, so it is doubled. */
const q = (path: string) => `"${path.replace(/%/g, '%%')}"`;
const batch = (...lines: string[]) => ['@echo off', ...lines, ''].join('\r\n');

export interface ShimInput {
  paths: TerminalPaths;
  /** ExamGuard.exe (Electron), run as Node. */
  nodeExe: string;
  npmCli: string | null;
  msysRoot: string | null;
}

/**
 * `.cmd` files for the shims folder (first on PATH). `node` is Electron with
 * `ELECTRON_RUN_AS_NODE=1`, so no separate Node is bundled. `pacman` installs into the
 * student's workspace with its own database and keyring copy, so the bundled MSYS2 tree (read
 * only once installed) is never written. The first `pacman` call downloads the package list.
 */
export function shimFiles({ paths, nodeExe, npmCli, msysRoot }: ShimInput): Record<string, string> {
  const files: Record<string, string> = {
    'node.cmd': batch('setlocal', 'set "ELECTRON_RUN_AS_NODE=1"', `${q(nodeExe)} %*`),
  };
  if (npmCli) {
    files['npm.cmd'] = batch(`"%~dp0node.cmd" ${q(npmCli)} %*`);
    files['npx.cmd'] = batch(`"%~dp0node.cmd" ${q(join(npmCli, '..', 'npx-cli.js'))} %*`);
  }
  if (msysRoot) {
    const root = toMsysPath(paths.msysOverlay);
    const pacman = q(join(msysRoot, 'usr', 'bin', 'pacman.exe'));
    const options = [
      `--root ${q(root)}`,
      `--dbpath ${q(`${root}/var/lib/pacman`)}`,
      `--cachedir ${q(`${root}/var/cache/pacman/pkg`)}`,
      `--logfile ${q(`${root}/var/log/pacman.log`)}`,
      `--gpgdir ${q(toMsysPath(join(paths.support, 'gnupg')))}`,
      `--config ${q(toMsysPath(join(paths.support, 'pacman.conf')))}`,
      // Install scripts expect a full MSYS2 system; library packages work without them.
      '--noscriptlet',
    ].join(' ');
    const syncDb = join(paths.msysOverlay, 'var', 'lib', 'pacman', 'sync', 'ucrt64.db');
    files['pacman.cmd'] = batch(
      'setlocal',
      `if not exist ${q(syncDb)} ${pacman} ${options} -Sy || exit /b 1`,
      `${pacman} ${options} %*`,
    );
  }
  return files;
}

/**
 * pacman.conf for the workspace: only the UCRT64 repo (it matches the WinLibs UCRT gcc). The
 * mirror list is read from the bundled MSYS2 tree, where `/etc` resolves.
 */
export const PACMAN_CONF = `[options]
Architecture = auto
SigLevel = Required DatabaseOptional
LocalFileSigLevel = Optional

[ucrt64]
Include = /etc/pacman.d/mirrorlist.mingw
`;

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Toolchain } from '../runner/toolchains.js';
import { PACMAN_CONF, shimFiles } from './shims.js';
import { initCommand, newNonce, shellInitScript } from './shellInit.js';
import { terminalEnv, terminalPaths } from './terminalEnv.js';

const BOM = String.fromCharCode(0xfeff);

/** What the pty spawns. */
export interface TerminalLaunch {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** The command-marker nonce written into this shell's init script. */
  nonce: string;
}

export interface LaunchInput {
  runRoot: string;
  tools: Toolchain;
  baseEnv: NodeJS.ProcessEnv;
  /** `powershell.exe` by full path (System32). */
  shell: string;
  /** Tests pass a fixed one. */
  nonce?: string;
}

/**
 * Copies regular files and folders (gpg may leave sockets behind; they are skipped). Not
 * `cpSync`: on an access error it ends the whole process instead of throwing.
 */
function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) copyTree(join(from, entry.name), join(to, entry.name));
    else if (entry.isFile()) copyFileSync(join(from, entry.name), join(to, entry.name));
  }
}

/**
 * Prepares the workspace (folders, shims, pacman.conf, a keyring copy on first use) and returns
 * the command: PowerShell in the workspace, with no wall time. Closing the terminal kills the
 * shell's process tree (`TerminalHost.close`), so everything the student started from it ends.
 */
export function prepareTerminal({
  runRoot,
  tools,
  baseEnv,
  shell,
  nonce = newNonce(),
}: LaunchInput): TerminalLaunch {
  const paths = terminalPaths(runRoot);
  for (const dir of [
    paths.workspace,
    paths.shims,
    join(paths.msysOverlay, 'var', 'lib', 'pacman'),
    join(paths.msysOverlay, 'var', 'cache', 'pacman', 'pkg'),
    join(paths.msysOverlay, 'var', 'log'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  const files = shimFiles({
    paths,
    nodeExe: tools.nodeExe,
    npmCli: tools.npmCli,
    msysRoot: tools.msysRoot,
    pythonExe: tools.pythonExe,
  });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(paths.shims, name), text);
  if (tools.msysRoot) {
    writeFileSync(join(paths.support, 'pacman.conf'), PACMAN_CONF);
    // gpg writes lock and trust files into its home, and the bundled tree is read-only once
    // installed, so each workspace verifies with its own copy (about 150 KB).
    const gnupg = join(paths.support, 'gnupg');
    if (!existsSync(gnupg)) {
      // Copied aside and renamed, so a failed copy is retried next time instead of kept.
      const partial = `${gnupg}.partial`;
      rmSync(partial, { recursive: true, force: true });
      copyTree(join(tools.msysRoot, 'etc', 'pacman.d', 'gnupg'), partial);
      renameSync(partial, gnupg);
    }
  }
  // Rewritten on every open with a new nonce. UTF-8 with a BOM, or PowerShell 5.1 reads it as
  // ANSI and a non-ASCII profile path in it would break.
  const initScript = join(paths.support, 'init.ps1');
  writeFileSync(initScript, BOM + shellInitScript(nonce, initScript), 'utf8');
  return {
    file: shell,
    args: ['-NoLogo', '-NoProfile', '-NoExit', '-Command', initCommand(initScript)],
    cwd: paths.workspace,
    env: terminalEnv({ base: baseEnv, paths, mingwBin: tools.mingwBin }),
    nonce,
  };
}

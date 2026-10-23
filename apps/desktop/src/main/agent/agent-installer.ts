import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunCommand } from './run-command.js';
import { INSTALL_SCRIPT, UNINSTALL_SCRIPT } from './setup-scripts.js';

export interface InstallerDeps {
  run: RunCommand;
  /** Where the script and its result file are written (a folder in the profile). */
  workDir: string;
}

/** PowerShell single-quoted string. */
const psq = (text: string) => `'${text.replaceAll("'", "''")}'`;

/**
 * Runs `script` in an elevated PowerShell and returns `null` on success, otherwise a message.
 * Windows shows its UAC prompt; declining it ends up as the "declined" message.
 */
async function runElevated(
  script: string,
  scriptArgs: Record<string, string>,
  deps: InstallerDeps,
): Promise<string | null> {
  const scriptPath = join(deps.workDir, 'agent-setup.ps1');
  const resultPath = join(deps.workDir, 'agent-setup.result');
  await mkdir(deps.workDir, { recursive: true });
  await rm(resultPath, { force: true });
  await writeFile(scriptPath, script, 'utf8');

  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
  for (const [name, value] of Object.entries({ ...scriptArgs, Result: resultPath })) {
    args.push(`-${name}`, value);
  }
  // Start-Process joins the list with spaces, so every value gets its own double quotes.
  const list = args.map((a) => psq(a.startsWith('-') && !a.includes(' ') ? a : `"${a}"`));
  const command = [
    'try {',
    `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @(${list.join(',')})`,
    '} catch { exit 3 }',
  ].join(' ');
  await deps.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);

  const result = await readFile(resultPath, 'utf8').catch(() => null);
  if (result === null) return 'Administrator approval was declined, so monitoring was not set up.';
  const text = result.trim();
  return text === 'ok' ? null : text || 'The setup script failed.';
}

/**
 * Copies `exe` under Program Files and (re)creates + starts the service. `appPath` (dev builds) is
 * the student app's program file, registered so the agent accepts its pipe connection.
 */
export function installAgent(
  exe: string,
  deps: InstallerDeps,
  appPath?: string,
): Promise<string | null> {
  return runElevated(INSTALL_SCRIPT, { Source: exe, ...(appPath ? { App: appPath } : {}) }, deps);
}

export function uninstallAgent(deps: InstallerDeps): Promise<string | null> {
  return runElevated(UNINSTALL_SCRIPT, {}, deps);
}

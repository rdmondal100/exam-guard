import { join } from 'node:path';
import type { RunCommand } from './run-command.js';
import { SERVICE_NAME } from './service-state.js';

/** `sc queryex` output: the process id of the running service. */
export function parseServicePid(stdout: string): number | null {
  const pid = /^\s*PID\s*:\s*(\d+)/m.exec(stdout)?.[1];
  const value = pid === undefined ? 0 : Number(pid);
  return value > 0 ? value : null;
}

/** `sc qc` output: the program file of the service, without quotes and arguments. */
export function parseBinaryPath(stdout: string): string | null {
  const line = /BINARY_PATH_NAME\s*:\s*(.+)/.exec(stdout)?.[1]?.trim();
  if (!line) return null;
  const quoted = /^"([^"]+)"/.exec(line)?.[1];
  if (quoted) return quoted;
  const bare = /^(.+?\.exe)\b/i.exec(line)?.[1];
  return bare ?? null;
}

export interface AgentPathEnv {
  isPackaged: boolean;
  /** `process.resourcesPath` of a packaged app. */
  resourcesPath: string;
  env: NodeJS.ProcessEnv;
}

/**
 * The program file the service must run, in a folder a standard user cannot write to. Packaged:
 * the installer registers the copy next to this app's resources (the per-machine install folder).
 * Dev: where the install script copies it.
 */
export function installedAgentPath(t: AgentPathEnv): string {
  if (t.isPackaged) return join(t.resourcesPath, 'eg-agent.exe');
  return join(t.env['ProgramFiles'] ?? 'C:\\Program Files', 'ExamGuard', 'agent', 'eg-agent.exe');
}

const same = (a: string, b: string) =>
  a.replaceAll('/', '\\').toLowerCase() === b.replaceAll('/', '\\').toLowerCase();

/**
 * Node cannot ask a pipe which process owns it, so the agent's hello carries its process id and
 * this checks it against the Service Control Manager: the id must be the running service's, and
 * the service must run the installed program file. Together with the pipe's access list (the
 * service created every instance, a user process can create none) this proves who answered.
 */
export async function verifyAgentService(
  claimedPid: number,
  run: RunCommand,
  expectedPath: string,
): Promise<boolean> {
  const [queryex, config] = await Promise.all([
    run('sc.exe', ['queryex', SERVICE_NAME]),
    run('sc.exe', ['qc', SERVICE_NAME]),
  ]);
  const running = parseServicePid(queryex.stdout);
  const binary = parseBinaryPath(config.stdout);
  return running === claimedPid && binary !== null && same(binary, expectedPath);
}

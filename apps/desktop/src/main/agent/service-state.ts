import type { AgentState } from '@examguard/shared';
import type { RunCommand } from './run-command.js';

export const SERVICE_NAME = 'ExamGuardAgent';

const ERROR_SERVICE_DOES_NOT_EXIST = 1060;
const STATE_STOPPED = '1';
const STATE_RUNNING = '4';

/**
 * Reads `sc query` output. The state is the number after `STATE :`, which stays the same in every
 * Windows language (the word next to it does not).
 */
export function parseScQuery(stdout: string, code: number): AgentState {
  if (code === ERROR_SERVICE_DOES_NOT_EXIST) return 'missing';
  const state = /STATE\s*:\s*(\d+)/.exec(stdout)?.[1];
  if (state === STATE_RUNNING) return 'running';
  if (state === STATE_STOPPED) return 'stopped';
  return 'unknown';
}

export async function queryAgentService(run: RunCommand): Promise<AgentState> {
  const { stdout, code } = await run('sc.exe', ['query', SERVICE_NAME]);
  return parseScQuery(stdout, code);
}

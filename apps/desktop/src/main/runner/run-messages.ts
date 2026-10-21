import { RUN_LIMITS, type RunStatus } from '@examguard/shared';

const KB = Math.round(RUN_LIMITS.outputBytes / 1024);

/** The plain-language line shown under the output for each way a run can end. */
export const RUN_MESSAGES: Record<Exclude<RunStatus, 'ok' | 'failed' | 'cooldown'>, string> = {
  compile_error: 'Compile failed. See the Errors tab.',
  time_limit: `Stopped: the program ran longer than ${RUN_LIMITS.timeMs / 1000} s.`,
  memory_limit: `Memory limit: the program asked for more than ${RUN_LIMITS.memoryMb} MB.`,
  output_limit: `Stopped: the program printed more than ${KB} KB.`,
  process_limit: `Stopped: the program tried to start too many processes (limit ${RUN_LIMITS.processes}).`,
  stopped: 'Stopped.',
  busy: 'A run is already going. Stop it first.',
};

/** Windows crash codes, as the signed exit code a program returns. */
const CRASHES: Record<number, string> = {
  [0xc0000005 | 0]: 'access violation (bad pointer or array index)',
  [0xc00000fd | 0]: 'stack overflow (often endless recursion)',
  [0xc0000094 | 0]: 'integer division by zero',
  [0xc0000409 | 0]: 'abnormal termination',
  [0xc000001d | 0]: 'illegal instruction',
};

/** Explains a crash exit code, or returns '' for an ordinary one. */
export function crashMessage(exitCode: number | null): string {
  const what = exitCode === null ? undefined : CRASHES[exitCode];
  return what ? `The program crashed: ${what}.` : '';
}

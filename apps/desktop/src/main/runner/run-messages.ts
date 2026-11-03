import { DEFAULT_RUN_LIMITS, type RunLimits, type RunStatus } from '@examguard/shared';

/** The plain-language line shown under the output for each way a run can end. */
/** "5 s" or "10 min". */
const span = (ms: number) => (ms >= 60_000 ? `${ms / 60_000} min` : `${ms / 1000} s`);

export const timeLimitMessage = (ms: number) => `Stopped: the program ran longer than ${span(ms)}.`;

type LimitStatus = 'time_limit' | 'memory_limit' | 'output_limit' | 'process_limit';

/** The message for a limit, with the exam's own numbers (M43: the teacher sets them). */
export function limitMessage(
  status: LimitStatus,
  limits: RunLimits,
  timeMs = limits.timeMs,
): string {
  switch (status) {
    case 'time_limit':
      return timeLimitMessage(timeMs);
    case 'memory_limit':
      return `Memory limit: the program asked for more than ${limits.memoryMb} MB.`;
    case 'output_limit':
      return `Stopped: the program printed more than ${Math.round(limits.outputBytes / 1024)} KB.`;
    case 'process_limit':
      return `Stopped: the program tried to start too many processes (limit ${limits.processes}).`;
  }
}

export const RUN_MESSAGES: Record<Exclude<RunStatus, 'ok' | 'failed' | 'cooldown'>, string> = {
  compile_error: 'Compile failed. See the Errors tab.',
  time_limit: limitMessage('time_limit', DEFAULT_RUN_LIMITS),
  memory_limit: limitMessage('memory_limit', DEFAULT_RUN_LIMITS),
  output_limit: limitMessage('output_limit', DEFAULT_RUN_LIMITS),
  process_limit: limitMessage('process_limit', DEFAULT_RUN_LIMITS),
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

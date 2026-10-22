import type { SessionState } from '@examguard/shared';

/**
 * Until M15b brings the teacher's on/off switch (`state.terminal`), the terminal is a dev-only
 * spike: `EG_TERMINAL=1` in an unpackaged app. A packaged app never opens it.
 */
export function terminalEnabled(isPackaged: boolean, env: NodeJS.ProcessEnv): boolean {
  return !isPackaged && env.EG_TERMINAL === '1';
}

/** Why the terminal may not open now, or `null` if it may. */
export function terminalRefusal(exam: SessionState | null, enabled: boolean): string | null {
  if (!enabled) return 'The terminal is turned off for this exam.';
  if (exam?.examState !== 'running')
    return 'The terminal is only available while the exam is running.';
  return null;
}

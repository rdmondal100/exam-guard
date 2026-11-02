import type { Severity } from '@examguard/shared';

/**
 * A simple severity for agent events until the classifier arrives (M31): leaving the exam is
 * medium, leaving it for a program on the teacher's high-severity list is high, the rest is low.
 */
export function placeholderSeverity(
  type: string,
  details: Record<string, unknown>,
  highSeverityApps: readonly string[],
): Severity {
  if (type === 'monitor_changed') return monitorSeverity(details);
  const exe = typeof details['exe'] === 'string' ? details['exe'].toLowerCase() : '';
  if (exe && highSeverityApps.some((app) => app.toLowerCase() === exe)) {
    return type === 'focus_returned' ? 'low' : 'high';
  }
  // The app was gone (killed) long enough for the agent to start it again (M24); Task Manager and
  // the Ctrl+Alt+Del screen (M26, requirements §8.6).
  return MEDIUM_AGENT_TYPES.has(type) ? 'medium' : 'low';
}

const MEDIUM_AGENT_TYPES = new Set([
  'focus_lost',
  'app_relaunched',
  'taskmgr_opened',
  'secure_desktop',
]);

/**
 * A screen plugged in mid-exam is high (requirements §8.6); more than one screen already at the
 * start (no `monitorsBefore`) is medium; a screen taken away is low.
 */
function monitorSeverity(details: Record<string, unknown>): Severity {
  const now = typeof details['monitors'] === 'number' ? details['monitors'] : 0;
  const before = details['monitorsBefore'];
  if (typeof before !== 'number') return now > 1 ? 'medium' : 'low';
  return now > before && now > 1 ? 'high' : 'low';
}

/**
 * App events are low until the classifier (M31), except a lost agent link, which is critical (M24),
 * and a blocked outside paste, which is medium (M25, requirements §8.6).
 */
export function appEventSeverity(type: string): Severity {
  if (type === 'agent_lost') return 'critical';
  return type === 'paste_blocked' ? 'medium' : 'low';
}

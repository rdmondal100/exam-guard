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
  const exe = typeof details['exe'] === 'string' ? details['exe'].toLowerCase() : '';
  if (exe && highSeverityApps.some((app) => app.toLowerCase() === exe)) {
    return type === 'focus_returned' ? 'low' : 'high';
  }
  // The app was gone (killed) long enough for the agent to start it again (M24).
  return type === 'focus_lost' || type === 'app_relaunched' ? 'medium' : 'low';
}

/** App events are low until the classifier (M31), except a lost agent link, which is critical (M24). */
export function appEventSeverity(type: string): Severity {
  return type === 'agent_lost' ? 'critical' : 'low';
}

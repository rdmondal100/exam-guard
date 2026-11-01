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
  return type === 'focus_lost' ? 'medium' : 'low';
}

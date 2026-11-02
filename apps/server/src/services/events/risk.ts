import type { Severity } from '@examguard/shared';

/** Points one event adds to the student's risk score, by severity (M31). */
export const RISK_POINTS: Record<Severity, number> = { low: 1, medium: 3, high: 8, critical: 20 };

/**
 * Events that say nothing about cheating and add no risk: the student's own work (runs, terminal,
 * packages), the teacher's internet switch, the network coming back and the start snapshot (a
 * high-severity program running at the start shows up through its own switches).
 */
const NEUTRAL_TYPES = new Set([
  'run_executed',
  'terminal_opened',
  'terminal_closed',
  'terminal_command',
  'package_installed',
  'internet_blocked',
  'internet_allowed',
  'internet_block_failed',
  'network_restored',
  'processes_at_start',
]);

/**
 * The risk score is the sum of these points over a student's events, kept in
 * `exam_students.risk_score` as each event is stored. Time outside counts through the events it
 * produces: a periodic shot every 20 s while away, and the return, both graded by duration.
 */
export function riskPoints(type: string, severity: Severity): number {
  return NEUTRAL_TYPES.has(type) ? 0 : RISK_POINTS[severity];
}

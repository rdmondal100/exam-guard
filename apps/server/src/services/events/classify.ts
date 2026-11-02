import type { Severity } from '@examguard/shared';

/** A switch away from the exam shorter than this is "short" (requirements §8.6, low). */
export const SHORT_SWITCH_MS = 10_000;
/** Outside the exam at least this long is "long time outside" (high). */
export const LONG_OUTSIDE_MS = 60_000;

export interface ClassifyInput {
  type: string;
  details: Record<string, unknown>;
  /** The exam's high-severity programs (browsers, messaging, remote access), exe names. */
  highSeverityApps: readonly string[];
  /** `title_changed` / `still_outside`: how long the student has been outside so far, if known. */
  outsideMs?: number;
}

const MEDIUM_TYPES = new Set([
  'app_relaunched',
  'taskmgr_opened',
  'secure_desktop',
  'paste_blocked',
  'network_lost',
]);
const HIGH_TYPES = new Set(['large_insertion']);
const CRITICAL_TYPES = new Set(['agent_lost', 'duplicate_login']);

const lower = (value: unknown): string => (typeof value === 'string' ? value.toLowerCase() : '');

function isHighApp(exe: string, apps: readonly string[]): boolean {
  return exe !== '' && apps.some((app) => app.toLowerCase() === exe);
}

/** Time outside → severity: short is low, long is high, in between medium. */
function byDuration(ms: number): Severity {
  if (ms >= LONG_OUTSIDE_MS) return 'high';
  return ms >= SHORT_SWITCH_MS ? 'medium' : 'low';
}

/**
 * The server's severity for every event (M31, requirements §8.6). Leaving the exam is judged by
 * where the student went and for how long: a program on the teacher's list is high at once; any
 * other switch starts low and rises with the time outside (the periodic shots and the return carry
 * it), so a short Notepad switch stays low while a long one becomes high.
 */
export function classifyEvent({
  type,
  details,
  highSeverityApps,
  outsideMs,
}: ClassifyInput): Severity {
  if (CRITICAL_TYPES.has(type)) return 'critical';
  if (HIGH_TYPES.has(type)) return 'high';
  const highApp = isHighApp(lower(details['exe']), highSeverityApps);
  switch (type) {
    case 'focus_lost':
      return highApp ? 'high' : 'low';
    case 'title_changed':
    case 'still_outside':
      return highApp ? 'high' : byDuration(outsideMs ?? 0);
    case 'focus_returned':
      return byDuration(typeof details['durationMs'] === 'number' ? details['durationMs'] : 0);
    case 'app_launched':
      return highApp ? 'high' : 'medium';
    case 'processes_at_start':
      return startListHasHighApp(details, highSeverityApps) ? 'medium' : 'low';
    case 'monitor_changed':
      return monitorSeverity(details);
    default:
      return MEDIUM_TYPES.has(type) ? 'medium' : 'low';
  }
}

function startListHasHighApp(details: Record<string, unknown>, apps: readonly string[]): boolean {
  const list = details['processes'];
  if (!Array.isArray(list)) return false;
  return list.some(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      isHighApp(lower((item as Record<string, unknown>)['exe']), apps),
  );
}

/**
 * A screen plugged in mid-exam is high; more than one screen already at the start (no
 * `monitorsBefore`) is medium; a screen taken away is low (M26).
 */
function monitorSeverity(details: Record<string, unknown>): Severity {
  const now = typeof details['monitors'] === 'number' ? details['monitors'] : 0;
  const before = details['monitorsBefore'];
  if (typeof before !== 'number') return now > 1 ? 'medium' : 'low';
  return now > before && now > 1 ? 'high' : 'low';
}

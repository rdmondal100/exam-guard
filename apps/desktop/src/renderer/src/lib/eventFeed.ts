import { severityAtLeast, type EventRow, type Severity } from '@examguard/shared';

/** Most events one list keeps in memory. */
export const FEED_LIMIT = 500;

/** The alert feed's severity filter: this severity and above (M31). */
export const MIN_SEVERITY_CHOICES: readonly { value: Severity; label: string }[] = [
  { value: 'low', label: 'All' },
  { value: 'medium', label: 'Medium and up' },
  { value: 'high', label: 'High and up' },
  { value: 'critical', label: 'Critical only' },
];

export interface FeedFilter {
  studentId?: string;
  minSeverity?: Severity;
}

export function matchesFilter(event: EventRow, { studentId, minSeverity }: FeedFilter): boolean {
  if (studentId && event.examStudentId !== studentId) return false;
  return !minSeverity || severityAtLeast(event.severity, minSeverity);
}

/**
 * The fetched list plus the alerts pushed since (newest first, one row per id, at most `limit`).
 * Live alerts that do not match the filter are left out.
 */
export function mergeEvents(
  loaded: readonly EventRow[],
  live: readonly EventRow[],
  filter: FeedFilter = {},
  limit = FEED_LIMIT,
): EventRow[] {
  const byId = new Map<number, EventRow>();
  for (const event of loaded) byId.set(event.id, event);
  for (const event of live) if (matchesFilter(event, filter)) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, limit);
}

/** Adds a pushed alert to the newest-first live list (ignores a repeat), capped at `limit`. */
export function pushAlert(
  alerts: readonly EventRow[],
  event: EventRow,
  limit = FEED_LIMIT,
): EventRow[] {
  if (alerts.some((a) => a.id === event.id)) return [...alerts];
  return [event, ...alerts].slice(0, limit);
}

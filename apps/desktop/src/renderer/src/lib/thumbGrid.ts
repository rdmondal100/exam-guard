import type { RosterEntry } from '@examguard/shared';
import { compareCodes, compareNames, statusRank } from './rosterTable';

/** Tiles per grid page (requirements §8: about 25–30). */
export const GRID_PAGE_SIZE = 30;

export type GridSort = 'risk' | 'name' | 'status';

export const GRID_SORTS: { value: GridSort; label: string }[] = [
  { value: 'risk', label: 'Risk (highest first)' },
  { value: 'name', label: 'Name' },
  { value: 'status', label: 'Status' },
];

/** The grid order: ties fall back to the student ID, so tiles do not jump around. */
export function gridOrder(students: readonly RosterEntry[], sort: GridSort): RosterEntry[] {
  const byCode = (a: RosterEntry, b: RosterEntry) => compareCodes(a.studentCode, b.studentCode);
  const compare: Record<GridSort, (a: RosterEntry, b: RosterEntry) => number> = {
    risk: (a, b) => b.riskScore - a.riskScore || byCode(a, b),
    name: compareNames,
    status: (a, b) => statusRank(a) - statusRank(b) || byCode(a, b),
  };
  return [...students].sort(compare[sort]);
}

export function pageCount(total: number, size = GRID_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** The page's rows; a page past the end shows the last one. */
export function pageOf<T>(rows: readonly T[], page: number, size = GRID_PAGE_SIZE): T[] {
  const last = pageCount(rows.length, size) - 1;
  const at = Math.min(Math.max(0, page), last);
  return rows.slice(at * size, (at + 1) * size);
}

/** Who should stream: the connected students on the page (an offline PC cannot send anything). */
export function streamIds(page: readonly RosterEntry[]): string[] {
  return page.filter((s) => s.connected).map((s) => s.id);
}

/** A stable key for a watch list, so the same page is not sent again. */
export function watchKey(ids: readonly string[]): string {
  return [...ids].sort().join(',');
}

/** "12 s ago" for a picture's age; `null` without a picture. */
export function thumbAge(ts: number | undefined, now: number): string | null {
  if (ts === undefined) return null;
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return `${sec} s ago`;
  return `${Math.floor(sec / 60)} min ago`;
}

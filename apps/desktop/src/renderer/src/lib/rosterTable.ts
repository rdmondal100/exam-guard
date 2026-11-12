import type { RosterEntry, StudentState } from '@examguard/shared';

/** Status order in the roster: students who need the teacher first. */
const STATE_ORDER: Record<StudentState, number> = {
  locked: 0,
  active: 1,
  lobby: 2,
  submitted: 3,
  ended_by_teacher: 4,
  not_joined: 5,
};

/** Status for sorting: needs attention first, and offline before online within a state. */
export function statusRank(entry: RosterEntry): number {
  return STATE_ORDER[entry.state] * 2 + (entry.connected ? 1 : 0);
}

export function compareCodes(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export function compareNames(a: RosterEntry, b: RosterEntry): number {
  return (
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
    compareCodes(a.studentCode, b.studentCode)
  );
}

/** The roster's status words. */
export function statusText(entry: RosterEntry): string {
  const state = entry.state === 'ended_by_teacher' ? 'ended' : entry.state;
  return entry.connected ? state : `${state} · offline`;
}

/** Risk score bands for the roster badge. */
export function riskLevel(score: number): 'none' | 'low' | 'medium' | 'high' {
  if (score >= 40) return 'high';
  if (score >= 15) return 'medium';
  return score > 0 ? 'low' : 'none';
}

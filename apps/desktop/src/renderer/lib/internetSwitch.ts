import type { InternetState, RosterEntry } from '@examguard/shared';

export interface InternetCoverage {
  /** Connected students that are working (in the lobby or in the exam). */
  total: number;
  /** Of those, the PCs whose agent confirmed what the teacher asked for. */
  applied: number;
}

/** How many connected PCs match the switch: blocked ones when it is off, unblocked when it is on. */
export function internetCoverage(students: RosterEntry[], wanted: InternetState): InternetCoverage {
  const working = students.filter(
    (s) => s.connected && (s.state === 'lobby' || s.state === 'active' || s.state === 'locked'),
  );
  const applied = working.filter((s) => s.internetBlocked === (wanted === 'blocked')).length;
  return { total: working.length, applied };
}

/** What the teacher's internet control says about the current switch. */
export function internetLabel(state: InternetState, coverage: InternetCoverage): string {
  if (state === 'allowed') return 'On';
  return `Off · applied on ${coverage.applied} of ${coverage.total} PCs`;
}

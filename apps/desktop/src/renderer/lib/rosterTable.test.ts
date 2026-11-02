import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '@examguard/shared';
import { compareCodes, compareNames, riskLevel, statusRank, statusText } from './rosterTable';

const entry = (over: Partial<RosterEntry> = {}): RosterEntry => ({
  id: 'a',
  studentCode: '1',
  name: 'Ada',
  state: 'active',
  connected: true,
  riskScore: 0,
  outsideMs: 0,
  lastSeen: null,
  agentOk: true,
  internetBlocked: false,
  monitors: 1,
  ...over,
});

describe('rosterTable', () => {
  it('ranks locked first, then working, lobby and finished; offline before online', () => {
    const order = [
      entry({ state: 'submitted' }),
      entry({ state: 'lobby' }),
      entry({ state: 'active' }),
      entry({ state: 'active', connected: false }),
      entry({ state: 'locked' }),
    ].sort((a, b) => statusRank(a) - statusRank(b));
    expect(order.map((e) => `${e.state}${e.connected ? '' : '-off'}`)).toEqual([
      'locked',
      'active-off',
      'active',
      'lobby',
      'submitted',
    ]);
  });

  it('sorts codes numerically and names without case, codes breaking ties', () => {
    expect(['10', '9', '100'].sort(compareCodes)).toEqual(['9', '10', '100']);
    const names = [
      entry({ name: 'bob', studentCode: '2' }),
      entry({ name: 'Bob', studentCode: '1' }),
      entry({ name: 'alice' }),
    ].sort(compareNames);
    expect(names.map((e) => `${e.name}${e.studentCode}`)).toEqual(['alice1', 'Bob1', 'bob2']);
  });

  it('describes the status and the risk band', () => {
    expect(statusText(entry({ state: 'ended_by_teacher' }))).toBe('ended');
    expect(statusText(entry({ connected: false }))).toBe('active · offline');
    expect([0, 3, 15, 40].map(riskLevel)).toEqual(['none', 'low', 'medium', 'high']);
  });
});

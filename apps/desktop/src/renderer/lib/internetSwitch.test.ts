import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '@examguard/shared';
import { internetCoverage, internetLabel } from './internetSwitch';

const student = (over: Partial<RosterEntry>): RosterEntry => ({
  id: 'a',
  studentCode: '1',
  name: 'A',
  state: 'active',
  connected: true,
  riskScore: 0,
  outsideMs: 0,
  lastSeen: null,
  agentOk: true,
  internetBlocked: false,
  ...over,
});

describe('internetCoverage', () => {
  it('counts blocked PCs when the switch is off', () => {
    const roster = [
      student({ id: 'a', internetBlocked: true }),
      student({ id: 'b', internetBlocked: true, state: 'lobby' }),
      student({ id: 'c', internetBlocked: false }),
    ];
    expect(internetCoverage(roster, 'blocked')).toEqual({ total: 3, applied: 2 });
  });

  it('counts unblocked PCs when the switch is on', () => {
    const roster = [student({ id: 'a', internetBlocked: true }), student({ id: 'b' })];
    expect(internetCoverage(roster, 'allowed')).toEqual({ total: 2, applied: 1 });
  });

  it('leaves out offline, submitted and ended students', () => {
    const roster = [
      student({ id: 'a', connected: false }),
      student({ id: 'b', state: 'submitted' }),
      student({ id: 'c', state: 'ended_by_teacher' }),
      student({ id: 'd', state: 'not_joined' }),
      student({ id: 'e', internetBlocked: true }),
    ];
    expect(internetCoverage(roster, 'blocked')).toEqual({ total: 1, applied: 1 });
  });
});

describe('internetLabel', () => {
  it('says On, or how many PCs have the block', () => {
    expect(internetLabel('allowed', { total: 3, applied: 3 })).toBe('On');
    expect(internetLabel('blocked', { total: 3, applied: 2 })).toBe('Off · applied on 2 of 3 PCs');
  });
});

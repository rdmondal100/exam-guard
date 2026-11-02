import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '@examguard/shared';
import { gridOrder, pageCount, pageOf, streamIds, thumbAge, watchKey } from './thumbGrid';

const s = (id: string, over: Partial<RosterEntry> = {}): RosterEntry => ({
  id,
  studentCode: id,
  name: `Student ${id}`,
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

describe('grid helpers', () => {
  it('orders by risk with the ID breaking ties, by name, or by status', () => {
    const rows = [
      s('3', { riskScore: 5 }),
      s('10'),
      s('2'),
      s('1', { riskScore: 5, state: 'locked' }),
    ];
    expect(gridOrder(rows, 'risk').map((r) => r.id)).toEqual(['1', '3', '2', '10']);
    expect(gridOrder(rows, 'name').map((r) => r.id)).toEqual(['1', '10', '2', '3']);
    expect(gridOrder(rows, 'status')[0]?.id).toBe('1');
  });

  it('pages 30 at a time and clamps a page past the end', () => {
    const rows = Array.from({ length: 65 }, (_, i) => i);
    expect(pageCount(rows.length)).toBe(3);
    expect(pageCount(0)).toBe(1);
    expect(pageOf(rows, 0)).toHaveLength(30);
    expect(pageOf(rows, 2)).toEqual([60, 61, 62, 63, 64]);
    expect(pageOf(rows, 9)).toEqual([60, 61, 62, 63, 64]);
  });

  it('streams only connected students and keys a watch list by its members', () => {
    expect(streamIds([s('a'), s('b', { connected: false })])).toEqual(['a']);
    expect(watchKey(['b', 'a'])).toBe(watchKey(['a', 'b']));
  });

  it('says how old a picture is', () => {
    expect(thumbAge(undefined, 10_000)).toBeNull();
    expect(thumbAge(6000, 10_000)).toBe('4 s ago');
    expect(thumbAge(0, 130_000)).toBe('2 min ago');
  });
});

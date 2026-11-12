import { describe, expect, it } from 'vitest';
import type { EventRow, Severity } from '@examguard/shared';
import { matchesFilter, mergeEvents, pushAlert } from './eventFeed';

const ev = (id: number, severity: Severity = 'low', student = 's1'): EventRow => ({
  id,
  examStudentId: student,
  studentCode: '1',
  studentName: 'Ada',
  type: 'focus_lost',
  severity,
  serverTs: id,
  clientTs: id,
  details: {},
  hasScreenshot: false,
});

describe('eventFeed', () => {
  it('filters by student and by severity and above', () => {
    expect(matchesFilter(ev(1, 'high'), { minSeverity: 'medium' })).toBe(true);
    expect(matchesFilter(ev(1, 'low'), { minSeverity: 'medium' })).toBe(false);
    expect(matchesFilter(ev(1, 'critical', 's2'), { studentId: 's1' })).toBe(false);
    expect(matchesFilter(ev(1), {})).toBe(true);
  });

  it('merges fetched and live events newest first, once per id, matching the filter', () => {
    const merged = mergeEvents([ev(3), ev(1)], [ev(5, 'high'), ev(4, 'low'), ev(3, 'medium')], {
      minSeverity: 'medium',
    });
    expect(merged.map((e) => e.id)).toEqual([5, 3, 1]);
    expect(merged[1]?.severity).toBe('medium');
    expect(mergeEvents([ev(1), ev(2)], [ev(3)], {}, 2).map((e) => e.id)).toEqual([3, 2]);
  });

  it('keeps pushed alerts newest first, without repeats, up to the limit', () => {
    let alerts = pushAlert([], ev(1));
    alerts = pushAlert(alerts, ev(2));
    alerts = pushAlert(alerts, ev(2));
    expect(alerts.map((e) => e.id)).toEqual([2, 1]);
    expect(pushAlert(alerts, ev(3), 2).map((e) => e.id)).toEqual([3, 2]);
  });
});

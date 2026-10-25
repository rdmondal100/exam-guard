import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '@examguard/shared';
import {
  EMPTY_ROSTER,
  applyTeacherMessage,
  parseTeacherFrame,
  sortedStudents,
} from './rosterState';

const entry = (id: string, studentCode: string, connected = true): RosterEntry => ({
  id,
  studentCode,
  name: `Student ${studentCode}`,
  state: 'lobby',
  connected,
  riskScore: 0,
  outsideMs: 0,
  lastSeen: null,
  agentOk: true,
  internetBlocked: false,
});

describe('applyTeacherMessage', () => {
  it('adds students from a full roster and replaces them on a diff', () => {
    const full = applyTeacherMessage(EMPTY_ROSTER, {
      t: 'roster',
      students: [entry('a', '1'), entry('b', '2')],
    });
    const diff = applyTeacherMessage(full, { t: 'roster', students: [entry('b', '2', false)] });
    expect(diff.students.size).toBe(2);
    expect(diff.students.get('b')?.connected).toBe(false);
    expect(diff.students.get('a')?.connected).toBe(true);
    expect(full.students.get('b')?.connected).toBe(true);
  });

  it('stores hosting counts without the message tag', () => {
    const next = applyTeacherMessage(EMPTY_ROSTER, {
      t: 'hosting',
      joined: 3,
      inLobby: 3,
      active: 0,
      submitted: 0,
      connected: 2,
    });
    expect(next.counts).toEqual({ joined: 3, inLobby: 3, active: 0, submitted: 0, connected: 2 });
  });

  it('ignores notices', () => {
    expect(applyTeacherMessage(EMPTY_ROSTER, { t: 'notice', level: 'info', text: 'x' })).toBe(
      EMPTY_ROSTER,
    );
  });
});

describe('parseTeacherFrame', () => {
  it('parses a known frame and drops junk', () => {
    expect(parseTeacherFrame('{"t":"notice","level":"warn","text":"hi"}')).toMatchObject({
      t: 'notice',
    });
    expect(parseTeacherFrame('not json')).toBeNull();
    expect(parseTeacherFrame('{"t":"nope"}')).toBeNull();
  });
});

describe('sortedStudents', () => {
  it('orders codes numerically', () => {
    const state = applyTeacherMessage(EMPTY_ROSTER, {
      t: 'roster',
      students: [entry('c', '10'), entry('a', '2'), entry('b', '1')],
    });
    expect(sortedStudents(state).map((s) => s.studentCode)).toEqual(['1', '2', '10']);
  });
});

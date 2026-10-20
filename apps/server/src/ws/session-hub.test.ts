import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterEntry, ServerToTeacher } from '@examguard/shared';
import type { ExamStudentRepo } from '../db/exam-student-repo.js';
import { SessionHub, type StudentConn } from './session-hub.js';

const entry = (id: string, connected: boolean): RosterEntry => ({
  id,
  studentCode: id,
  name: id,
  state: 'lobby',
  connected,
  riskScore: 0,
  outsideMs: 0,
  lastSeen: null,
  agentOk: true,
});

function fakeRepo() {
  const connected = new Map<string, boolean>();
  const repo = {
    setConnected: vi.fn((id: string, value: boolean) => void connected.set(id, value)),
    rosterEntry: (id: string) => ({ examId: 'e1', entry: entry(id, connected.get(id) ?? false) }),
    roster: () => [] as RosterEntry[],
    counts: () => ({ joined: 0, inLobby: 0, active: 0, submitted: 0, connected: 0 }),
  };
  return { repo: repo as unknown as ExamStudentRepo, connected };
}

const conn = (): StudentConn & { closed: number[] } => {
  const closed: number[] = [];
  return { closed, send: () => {}, close: (code) => void closed.push(code) };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SessionHub', () => {
  it('batches changes into one roster push per window', () => {
    const { repo } = fakeRepo();
    const hub = new SessionHub({ students: repo, batchMs: 250 });
    const sent: ServerToTeacher[] = [];
    hub.subscribe({ examId: 'e1', send: (m) => sent.push(m) });
    sent.length = 0;

    hub.attach('a', conn(), 4409);
    hub.attach('b', conn(), 4409);
    hub.attach('a', conn(), 4409);
    expect(sent).toHaveLength(0);

    vi.advanceTimersByTime(250);
    const rosters = sent.filter((m) => m.t === 'roster');
    expect(rosters).toHaveLength(1);
    expect(rosters[0]?.t === 'roster' && rosters[0].students.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('closes the older socket when the same student connects again', () => {
    const { repo } = fakeRepo();
    const hub = new SessionHub({ students: repo });
    const first = conn();
    const second = conn();
    hub.attach('a', first, 4409);
    hub.attach('a', second, 4409);
    expect(first.closed).toEqual([4409]);
    hub.detach('a', first);
    expect(hub.isConnected('a')).toBe(true);
    hub.detach('a', second);
    expect(hub.isConnected('a')).toBe(false);
  });

  it('only pushes to subscribers of that exam', () => {
    const { repo } = fakeRepo();
    const hub = new SessionHub({ students: repo });
    const other: ServerToTeacher[] = [];
    hub.subscribe({ examId: 'other', send: (m) => other.push(m) });
    other.length = 0;
    hub.attach('a', conn(), 4409);
    vi.advanceTimersByTime(300);
    expect(other).toHaveLength(0);
  });

  it('stops pushing after unsubscribe and dispose', () => {
    const { repo } = fakeRepo();
    const hub = new SessionHub({ students: repo });
    const sent: ServerToTeacher[] = [];
    const off = hub.subscribe({ examId: 'e1', send: (m) => sent.push(m) });
    off();
    sent.length = 0;
    hub.attach('a', conn(), 4409);
    vi.advanceTimersByTime(300);
    expect(sent).toHaveLength(0);
    hub.dispose();
    hub.changed('a');
    expect(vi.getTimerCount()).toBe(0);
  });
});

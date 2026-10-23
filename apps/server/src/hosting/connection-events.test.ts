import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MONITORING } from '@examguard/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/connection.js';
import { initDatabase } from '../db/database.js';
import { EventRepo } from '../db/event-repo.js';
import { ExamRepo } from '../db/exam-repo.js';
import { ExamStudentRepo } from '../db/exam-student-repo.js';
import { ConnectionEvents, NETWORK_GRACE_MS } from './connection-events.js';

let dir: string;
let db: Db;
let events: EventRepo;
let clock: number;
let connections: ConnectionEvents;

const setExam = (state: string) => db.prepare('UPDATE exams SET state = ?').run(state);
const setStudent = (state: string) => db.prepare('UPDATE exam_students SET state = ?').run(state);
const types = () =>
  (db.prepare('SELECT type FROM events ORDER BY id').all() as { type: string }[]).map(
    (r) => r.type,
  );

function newConnections(): ConnectionEvents {
  return new ConnectionEvents({
    students: new ExamStudentRepo(db),
    exams: new ExamRepo(db),
    events,
    now: () => clock,
  });
}

/** Advances both the fake timers and the clock the events are stamped with. */
function pass(ms: number): void {
  clock += ms;
  vi.advanceTimersByTime(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  dir = mkdtempSync(join(tmpdir(), 'eg-conn-'));
  db = initDatabase(dir);
  db.exec(`
    INSERT INTO class_lists (id, name, created_at) VALUES ('l1', 'CSE', 1);
    INSERT INTO class_students (id, class_list_id, student_code, name) VALUES ('c1', 'l1', '1', 'Ada');
  `);
  db.prepare(
    `INSERT INTO exams (id, title, duration_sec, monitoring_json, state, created_at, updated_at)
     VALUES ('e1', 'Mid', 3600, ?, 'running', 1, 1)`,
  ).run(JSON.stringify(DEFAULT_MONITORING));
  db.exec(`
    INSERT INTO exam_students (id, exam_id, class_student_id, anon_id, state)
      VALUES ('s1', 'e1', 'c1', 'a', 'active');
  `);
  events = new EventRepo(db);
  clock = 1_000_000;
  connections = newConnections();
});

afterEach(() => {
  connections.reset();
  vi.useRealTimers();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ConnectionEvents', () => {
  it('raises nothing for a blip shorter than the grace period', () => {
    connections.onConnection('s1', false);
    pass(NETWORK_GRACE_MS - 1);
    connections.onConnection('s1', true);
    pass(NETWORK_GRACE_MS * 2);
    expect(types()).toEqual([]);
  });

  it('raises network_lost after the grace period, once, and network_restored with the downtime', () => {
    connections.onConnection('s1', false);
    pass(NETWORK_GRACE_MS);
    expect(types()).toEqual(['network_lost']);
    pass(50_000);
    connections.onConnection('s1', false); // a second close does not start another outage
    pass(NETWORK_GRACE_MS);
    expect(types()).toEqual(['network_lost']);

    connections.onConnection('s1', true);
    expect(types()).toEqual(['network_lost', 'network_restored']);
    expect(events.lastOfTypes('s1', ['network_restored'])?.details).toEqual({
      since: 1_000_000,
      downMs: 70_000,
    });
    expect(events.lastOfTypes('s1', ['network_lost'])?.details).toEqual({ since: 1_000_000 });
  });

  it('does not raise restored twice for one outage', () => {
    connections.onConnection('s1', false);
    pass(NETWORK_GRACE_MS);
    connections.onConnection('s1', true);
    connections.onConnection('s1', true);
    expect(types()).toEqual(['network_lost', 'network_restored']);
  });

  it('keeps a second outage apart from the first', () => {
    connections.onConnection('s1', false);
    pass(NETWORK_GRACE_MS);
    connections.onConnection('s1', true);
    pass(5000);
    connections.onConnection('s1', false);
    pass(NETWORK_GRACE_MS);
    connections.onConnection('s1', true);
    expect(types()).toEqual([
      'network_lost',
      'network_restored',
      'network_lost',
      'network_restored',
    ]);
  });

  it('stays quiet in the lobby and after the end', () => {
    setStudent('lobby');
    connections.onConnection('s1', false);
    pass(NETWORK_GRACE_MS);
    connections.onConnection('s1', true);
    setStudent('active');
    setExam('ended');
    connections.onConnection('s1', false);
    pass(NETWORK_GRACE_MS);
    connections.onConnection('s1', true);
    expect(types()).toEqual([]);
  });

  it('stays quiet for a student who already submitted', () => {
    setStudent('submitted');
    connections.onConnection('s1', false);
    pass(NETWORK_GRACE_MS);
    expect(types()).toEqual([]);
  });

  it('finishes an outage after a server restart (the lost state is in the database)', () => {
    connections.onConnection('s1', false);
    pass(NETWORK_GRACE_MS);
    connections.reset();
    const restarted = newConnections();
    pass(20_000);
    restarted.onConnection('s1', true);
    expect(types()).toEqual(['network_lost', 'network_restored']);
    restarted.reset();
  });

  it('forgets pending outages on reset (hosting stopped)', () => {
    connections.onConnection('s1', false);
    connections.reset();
    pass(NETWORK_GRACE_MS * 3);
    expect(types()).toEqual([]);
  });
});

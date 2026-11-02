import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MONITORING } from '@examguard/shared';
import type { Db } from '../../db/connectDb.js';
import { initDatabase } from '../../db/connectDb.js';
import { EventRepo } from '../../db/repositories/event.repo.js';
import { ExamRepo } from '../../db/repositories/exam.repo.js';
import { ExamStudentRepo } from '../../db/repositories/examStudent.repo.js';
import { EventRecorder, type RecordInput, type StoredEvent } from './event-recorder.js';
import { RISK_POINTS } from './risk.js';

let dir: string;
let db: Db;
let recorder: EventRecorder;
let heard: StoredEvent[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-recorder-'));
  db = initDatabase(dir);
  db.exec(`
    INSERT INTO class_lists (id, name, created_at) VALUES ('l1', 'CSE', 1);
    INSERT INTO class_students (id, class_list_id, student_code, name) VALUES ('c1', 'l1', '7', 'Ada');
  `);
  db.prepare(
    `INSERT INTO exams (id, title, duration_sec, monitoring_json, created_at, updated_at)
     VALUES ('e1', 'Mid', 3600, ?, 1, 1)`,
  ).run(JSON.stringify(DEFAULT_MONITORING));
  db.exec(
    "INSERT INTO exam_students (id, exam_id, class_student_id, anon_id) VALUES ('s1', 'e1', 'c1', 'a')",
  );
  const events = new EventRepo(db);
  recorder = new EventRecorder({
    events,
    students: new ExamStudentRepo(db),
    exams: new ExamRepo(db),
  });
  heard = [];
  recorder.onStored((stored) => heard.push(stored));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const input = (type: string, key: string, over: Partial<RecordInput> = {}): RecordInput => ({
  examId: 'e1',
  examStudentId: 's1',
  type,
  source: 'agent',
  details: {},
  serverTs: 100,
  clientTs: 1000,
  dedupeKey: key,
  ...over,
});
const risk = () =>
  (db.prepare('SELECT risk_score AS n FROM exam_students').get() as { n: number }).n;

describe('EventRecorder', () => {
  it('classifies, stores once, adds the risk points and tells the listeners', () => {
    const id = recorder.record(input('focus_lost', 'k1', { details: { exe: 'chrome.exe' } }));
    expect(id).not.toBeNull();
    expect(recorder.record(input('focus_lost', 'k1', { details: { exe: 'chrome.exe' } }))).toBe(
      null,
    );
    expect(risk()).toBe(RISK_POINTS.high);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({
      examId: 'e1',
      monitoring: true,
      riskAdded: RISK_POINTS.high,
      event: { id, type: 'focus_lost', severity: 'high', studentCode: '7', studentName: 'Ada' },
    });
  });

  it('keeps a given severity and does not alert or score the student’s own work', () => {
    recorder.record(input('run_executed', 'k2', { source: 'app', severity: 'medium' }));
    expect(risk()).toBe(0);
    expect(heard[0]).toMatchObject({ monitoring: false, riskAdded: 0 });
    expect(heard[0]?.event.severity).toBe('medium');
  });

  it('runs the attach step before the listeners hear of the event', () => {
    const order: string[] = [];
    recorder.onStored(() => order.push('listener'));
    recorder.record(input('focus_lost', 'k3'), () => order.push('attach'));
    expect(order).toEqual(['attach', 'listener']);
  });

  it('rates a shot while away by the time since the switch', () => {
    recorder.record(input('focus_lost', 'a', { details: { exe: 'notepad.exe' }, clientTs: 0 }));
    recorder.record(
      input('still_outside', 'b', { details: { exe: 'notepad.exe' }, clientTs: 20_000 }),
    );
    recorder.record(
      input('still_outside', 'c', { details: { exe: 'notepad.exe' }, clientTs: 61_000 }),
    );
    recorder.record(
      input('focus_returned', 'd', { details: { durationMs: 62_000 }, clientTs: 62_000 }),
    );
    // Back in the exam: a later title change has no open switch to measure from.
    recorder.record(
      input('title_changed', 'e', { details: { exe: 'notepad.exe' }, clientTs: 90_000 }),
    );
    expect(heard.map((h) => h.event.severity)).toEqual(['low', 'medium', 'high', 'high', 'low']);
  });

  it('scores a server event without a student nowhere', () => {
    recorder.record(input('network_lost', 'n', { examStudentId: null, source: 'server' }));
    expect(risk()).toBe(0);
    expect(heard[0]?.riskAdded).toBe(0);
  });
});

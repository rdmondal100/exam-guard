import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeScreenshotFrames, type EventReport } from '@examguard/shared';
import type { Db } from '../db/connection.js';
import { initDatabase } from '../db/database.js';
import { EventRepo } from '../db/event-repo.js';
import { ExamStudentRepo } from '../db/exam-student-repo.js';
import { EvidenceIntake } from './evidence-intake.js';
import { ScreenshotStore } from './screenshot-store.js';

let dir: string;
let db: Db;
let events: EventRepo;
let students: ExamStudentRepo;
let changed: string[];
let highApps: string[];
let intake: EvidenceIntake;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-evidence-'));
  db = initDatabase(dir);
  db.exec(`
    INSERT INTO class_lists (id, name, created_at) VALUES ('l1', 'CSE', 1);
    INSERT INTO class_students (id, class_list_id, student_code, name) VALUES ('c1', 'l1', '1', 'Ada');
    INSERT INTO exams (id, title, duration_sec, monitoring_json, created_at, updated_at)
      VALUES ('e1', 'Mid', 3600, '{}', 1, 1);
    INSERT INTO exam_students (id, exam_id, class_student_id, anon_id) VALUES ('s1', 'e1', 'c1', 'a');
  `);
  events = new EventRepo(db);
  students = new ExamStudentRepo(db);
  changed = [];
  highApps = [];
  intake = new EvidenceIntake({
    events,
    students,
    screenshots: new ScreenshotStore(dir),
    monitoring: () => ({ highSeverityApps: highApps }),
    changed: (id) => changed.push(id),
    now: () => 777,
  });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const report = (key: string, over: Partial<EventReport> = {}): EventReport => ({
  t: 'event',
  id: key,
  dedupeKey: key,
  clientTs: 5,
  type: 'focus_lost',
  details: { exe: 'chrome.exe', title: 'Google' },
  ...over,
});
const send = (ref: string, bytes = JPEG) => {
  for (const frame of encodeScreenshotFrames(ref, bytes)) intake.chunk('s1', frame);
};
interface Row {
  id: number;
  type: string;
  severity: string;
  source: string;
  dedupe_key: string;
  screenshot_path: string | null;
}
const rows = () =>
  db
    .prepare(
      'SELECT id, type, severity, source, dedupe_key, screenshot_path FROM events ORDER BY id',
    )
    .all() as Row[];
const outside = () =>
  (db.prepare('SELECT outside_ms_total AS n FROM exam_students').get() as { n: number }).n;

describe('EvidenceIntake', () => {
  it('stores an agent event with its picture on disk', () => {
    send('s1:1');
    intake.report('e1', 's1', report('s1:1', { screenshotRef: 's1:1' }));
    const [row] = rows();
    expect(row).toMatchObject({
      type: 'focus_lost',
      severity: 'medium',
      source: 'agent',
      dedupe_key: 'agent:s1:1',
    });
    expect(row?.screenshot_path).toBe(join('screenshots', 'e1', 's1', `${row?.id}.jpg`));
    expect(Array.from(readFileSync(join(dir, row?.screenshot_path ?? '')))).toEqual(
      Array.from(JPEG),
    );
  });

  it('stores the event without a picture when the pieces never came or are not a JPEG', () => {
    intake.report('e1', 's1', report('s1:2', { screenshotRef: 's1:2' }));
    send('s1:3', new Uint8Array(30).fill(1));
    intake.report('e1', 's1', report('s1:3', { screenshotRef: 's1:3' }));
    expect(rows().map((r) => r.screenshot_path)).toEqual([null, null]);
  });

  it('stores the process watcher events with their details and no picture', () => {
    const processes = [{ exe: 'Spotify.exe', pid: 11 }];
    intake.report('e1', 's1', report('s1:20', { type: 'processes_at_start', details: { processes } }));
    highApps = ['discord.exe'];
    intake.report('e1', 's1', report('s1:21', { type: 'app_launched', details: { exe: 'Discord.exe', pid: 5 } }));
    expect(rows().map((r) => [r.type, r.severity, r.source, r.screenshot_path])).toEqual([
      ['processes_at_start', 'low', 'agent', null],
      ['app_launched', 'high', 'agent', null],
    ]);
    const stored = db.prepare('SELECT details_json FROM events ORDER BY id').all() as { details_json: string }[];
    expect(JSON.parse(stored[0]?.details_json ?? '{}')).toEqual({ processes });
    expect(outside()).toBe(0);
  });

  it('uses the high-severity programs of the exam', () => {
    highApps = ['chrome.exe'];
    intake.report('e1', 's1', report('s1:4'));
    expect(rows()[0]?.severity).toBe('high');
  });

  it('adds the away time of focus_returned to the outside total, once', () => {
    const back = report('s1:5', { type: 'focus_returned', details: { durationMs: 12_000 } });
    intake.report('e1', 's1', back);
    intake.report('e1', 's1', back);
    const shorter = report('s1:6', { type: 'focus_returned', details: { durationMs: 500 } });
    intake.report('e1', 's1', shorter);
    expect(outside()).toBe(12_500);
    expect(changed).toEqual(['s1', 's1']);
    expect(rows()).toHaveLength(2);
  });

  it('does not count time for other events', () => {
    intake.report('e1', 's1', report('s1:7', { details: { durationMs: 9_000 } }));
    expect(outside()).toBe(0);
    expect(changed).toEqual([]);
  });

  it('keeps one row for an event that comes twice', () => {
    send('s1:8');
    intake.report('e1', 's1', report('s1:8', { screenshotRef: 's1:8' }));
    send('s1:8');
    intake.report('e1', 's1', report('s1:8', { screenshotRef: 's1:8' }));
    expect(rows()).toHaveLength(1);
  });

  it('forgets half-sent pictures of a student who left', () => {
    const frames = encodeScreenshotFrames('s1:9', new Uint8Array(250 * 1024).fill(1));
    intake.chunk('s1', frames[0] ?? new Uint8Array());
    intake.forget('s1');
    intake.chunk('s1', frames[1] ?? new Uint8Array());
    intake.report('e1', 's1', report('s1:9', { screenshotRef: 's1:9' }));
    expect(rows()[0]?.screenshot_path).toBeNull();
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/connection.js';
import { initDatabase } from '../db/database.js';
import { EventRepo, type NewEvent } from '../db/event-repo.js';
import { ScreenshotStore } from '../screenshots/screenshot-store.js';
import { buildTeacherApp } from './teacher-app.js';

const TOKEN = 't'.repeat(40);
const HEADERS = { 'x-teacher-token': TOKEN };

let app: FastifyInstance;
let db: Db;
let dir: string;
let events: EventRepo;
let examId: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'eg-events-'));
  db = initDatabase(dir);
  app = buildTeacherApp({
    token: TOKEN,
    db,
    hosting: { dataDir: dir, host: '127.0.0.1', port: 0, addresses: () => ['127.0.0.1'] },
  }).app;
  const call = (url: string, payload?: object) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, headers: HEADERS, payload });
  await call('/auth/setup', { password: 'correct horse battery' });
  examId = (await call('/exams', { title: 'Mid', durationMin: 60 })).json().id;
  db.exec(`
    INSERT INTO class_lists (id, name, created_at) VALUES ('l1', 'CSE', 1);
    INSERT INTO class_students (id, class_list_id, student_code, name) VALUES ('c1', 'l1', '1', 'Ada');
    INSERT INTO class_students (id, class_list_id, student_code, name) VALUES ('c2', 'l1', '2', 'Bob');
    INSERT INTO exam_students (id, exam_id, class_student_id, anon_id) VALUES ('s1', '${examId}', 'c1', 'a');
    INSERT INTO exam_students (id, exam_id, class_student_id, anon_id) VALUES ('s2', '${examId}', 'c2', 'b');
  `);
  events = new EventRepo(db);
});
afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: HEADERS });
const add = (over: Partial<NewEvent> = {}): number => {
  const id = events.insertReturningId({
    examId,
    examStudentId: 's1',
    type: 'focus_lost',
    severity: 'medium',
    source: 'agent',
    details: { exe: 'chrome.exe' },
    serverTs: 100,
    ...over,
  });
  if (id === null) throw new Error('duplicate');
  return id;
};
const ids = async (url: string) =>
  ((await get(url)).json().events as { id: number }[]).map((e) => e.id);

describe('GET /exams/:id/events', () => {
  it('lists the newest first with the student and whether a picture exists', async () => {
    const first = add();
    const second = add({ examStudentId: 's2', type: 'focus_returned', details: { durationMs: 5 } });
    const res = await get(`/exams/${examId}/events`);
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toMatchObject([
      {
        id: second,
        studentCode: '2',
        studentName: 'Bob',
        type: 'focus_returned',
        hasScreenshot: false,
      },
      { id: first, studentCode: '1', studentName: 'Ada', details: { exe: 'chrome.exe' } },
    ]);
  });

  it('filters by student, severity, source and the last id seen, and limits the page', async () => {
    const a = add();
    const b = add({ examStudentId: 's2', severity: 'high' });
    const c = add({ source: 'app', type: 'run_executed' });
    expect(await ids(`/exams/${examId}/events?studentId=s2`)).toEqual([b]);
    expect(await ids(`/exams/${examId}/events?severity=high`)).toEqual([b]);
    expect(await ids(`/exams/${examId}/events?source=agent`)).toEqual([b, a]);
    expect(await ids(`/exams/${examId}/events?after=${a}`)).toEqual([c, b]);
    expect(await ids(`/exams/${examId}/events?limit=1`)).toEqual([c]);
  });

  it('keeps one exam out of another', async () => {
    add();
    const other = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/exams',
        headers: HEADERS,
        payload: { title: 'Other', durationMin: 30 },
      })
    ).json().id as string;
    expect(await ids(`/exams/${other}/events`)).toEqual([]);
  });

  it('answers 404 for an unknown exam and 400 for a bad filter', async () => {
    expect((await get('/exams/nope/events')).statusCode).toBe(404);
    expect((await get(`/exams/${examId}/events?severity=scary`)).statusCode).toBe(400);
    expect((await get(`/exams/${examId}/events?limit=100000`)).statusCode).toBe(400);
  });

  it('needs the teacher to be logged in and to send the token', async () => {
    const noToken = await app.inject({ method: 'GET', url: `/api/v1/exams/${examId}/events` });
    expect(noToken.statusCode).toBe(401);
  });
});

describe('GET /screenshots/:eventId', () => {
  it('streams the stored JPEG', async () => {
    const id = add();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2]);
    events.setScreenshot(id, new ScreenshotStore(dir).save(examId, 's1', id, jpeg));
    const res = await get(`/screenshots/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(res.rawPayload).equals(jpeg)).toBe(true);
  });

  it('answers 404 for an event without a picture, an unknown id and a stored path that points outside', async () => {
    const plain = add();
    expect((await get(`/screenshots/${plain}`)).statusCode).toBe(404);
    expect((await get('/screenshots/99999')).statusCode).toBe(404);
    expect((await get('/screenshots/abc')).statusCode).toBe(404);
    const sneaky = add();
    events.setScreenshot(sneaky, join('screenshots', '..', 'examguard.sqlite'));
    expect((await get(`/screenshots/${sneaky}`)).statusCode).toBe(404);
  });

  it('is removed with the exam', async () => {
    const draft = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/exams',
        headers: HEADERS,
        payload: { title: 'Gone', durationMin: 30 },
      })
    ).json().id as string;
    const store = new ScreenshotStore(dir);
    const path = store.save(draft, 's1', 1, Buffer.from([0xff, 0xd8, 1, 2, 3]));
    expect(store.open(path)).not.toBeNull();
    await app.inject({ method: 'DELETE', url: `/api/v1/exams/${draft}`, headers: HEADERS });
    const stream = store.open(path);
    const failed = await new Promise<boolean>((resolve) => {
      stream?.on('error', () => resolve(true));
      stream?.on('end', () => resolve(false));
      stream?.resume();
    });
    expect(failed).toBe(true);
  });
});

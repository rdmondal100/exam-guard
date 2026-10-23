import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MONITORING } from '@examguard/shared';
import { initDatabase } from '../db/database.js';
import type { Db } from '../db/connection.js';
import { buildTeacherApp } from './teacher-app.js';

const TOKEN = 't'.repeat(40);
const HEADERS = { 'x-teacher-token': TOKEN };

let app: FastifyInstance;
let db: Db;
let dir: string;
let clock = 1000;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'eg-ex-'));
  db = initDatabase(dir);
  clock = 1000;
  app = buildTeacherApp({ token: TOKEN, db, now: () => clock++ }).app;
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    headers: HEADERS,
    payload: { password: 'correct horse battery' },
  });
});
afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const send = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: HEADERS, payload });
const createExam = async (payload: object = { title: 'Midterm', durationMin: 90 }) =>
  (await send('POST', '/exams', payload)).json();
const importList = async () =>
  (await send('POST', '/class-lists/import', { name: 'CSE', csvText: 'id,name\n1,Ada\n' })).json()
    .list;

describe('exam routes', () => {
  it('needs a login', async () => {
    await send('POST', '/auth/logout');
    const res = await send('GET', '/exams');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('login_required');
  });

  it('creates a draft with the default monitoring settings', async () => {
    const res = await send('POST', '/exams', { title: '  Midterm ', durationMin: 90 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      title: 'Midterm',
      state: 'draft',
      durationMin: 90,
      classListId: null,
      classListName: null,
      monitoring: DEFAULT_MONITORING,
    });
    expect((await send('GET', '/exams')).json()).toHaveLength(1);
  });

  it('rejects bad bodies and unknown class lists', async () => {
    expect((await send('POST', '/exams', { title: '', durationMin: 90 })).statusCode).toBe(400);
    expect((await send('POST', '/exams', { title: 'x', durationMin: 0 })).statusCode).toBe(400);
    const res = await send('POST', '/exams', { title: 'x', durationMin: 5, classListId: 'nope' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('class_list_not_found');
  });

  it('edits settings and keeps them (duration in minutes, class list assigned)', async () => {
    const list = await importList();
    const exam = await createExam();
    const res = await send('PATCH', `/exams/${exam.id}`, {
      title: 'Final',
      durationMin: 120,
      classListId: list.id,
    });
    expect(res.json()).toMatchObject({ title: 'Final', durationMin: 120, classListName: 'CSE' });
    expect((await send('GET', `/exams/${exam.id}`)).json()).toMatchObject({
      durationMin: 120,
      classListId: list.id,
    });
    const cleared = await send('PATCH', `/exams/${exam.id}`, { classListId: null });
    expect(cleared.json().classListId).toBeNull();
    expect(cleared.json().title).toBe('Final');
  });

  it('has the Files panel on by default, and the teacher can turn it off', async () => {
    const exam = await createExam();
    expect(exam.filesEnabled).toBe(true);
    const off = await send('PATCH', `/exams/${exam.id}`, { filesEnabled: false });
    expect(off.json().filesEnabled).toBe(false);
    expect((await send('GET', `/exams/${exam.id}`)).json().filesEnabled).toBe(false);
    // Other edits leave the switch alone, and a copy keeps it.
    const renamed = await send('PATCH', `/exams/${exam.id}`, { title: 'Quiz' });
    expect(renamed.json().filesEnabled).toBe(false);
    const copy = (await send('POST', `/exams/${exam.id}/duplicate`)).json();
    expect(copy.filesEnabled).toBe(false);
    const created = await send('POST', '/exams', {
      title: 'No files',
      durationMin: 5,
      filesEnabled: false,
    });
    expect(created.json().filesEnabled).toBe(false);
  });

  it('answers 404 for unknown exams', async () => {
    expect((await send('GET', '/exams/nope')).statusCode).toBe(404);
    expect((await send('PATCH', '/exams/nope', { title: 'x' })).statusCode).toBe(404);
    expect((await send('POST', '/exams/nope/duplicate')).statusCode).toBe(404);
    expect((await send('DELETE', '/exams/nope')).statusCode).toBe(404);
  });

  it('duplicates settings but no runtime data', async () => {
    const list = await importList();
    const exam = await createExam({ title: 'Midterm', durationMin: 45, classListId: list.id });
    db.prepare(
      "UPDATE exams SET state = 'ended', pin = '123456', global_extension_sec = 300, started_at = 5 WHERE id = ?",
    ).run(exam.id);

    const copy = (await send('POST', `/exams/${exam.id}/duplicate`)).json();
    expect(copy).toMatchObject({
      title: 'Midterm (copy)',
      state: 'draft',
      durationMin: 45,
      classListId: list.id,
      monitoring: exam.monitoring,
    });
    expect(copy.id).not.toBe(exam.id);
    const row = db
      .prepare('SELECT pin, global_extension_sec, started_at FROM exams WHERE id = ?')
      .get(copy.id);
    expect(row).toEqual({ pin: null, global_extension_sec: 0, started_at: null });
  });

  it('refuses to edit or delete an exam that is past ready', async () => {
    const exam = await createExam();
    db.prepare("UPDATE exams SET state = 'running' WHERE id = ?").run(exam.id);
    const patch = await send('PATCH', `/exams/${exam.id}`, { title: 'x' });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().error.code).toBe('invalid_state');
    expect((await send('DELETE', `/exams/${exam.id}`)).statusCode).toBe(409);
    expect((await send('GET', '/exams')).json()).toHaveLength(1);
  });

  it('deletes a draft', async () => {
    const exam = await createExam();
    expect((await send('DELETE', `/exams/${exam.id}`)).json()).toEqual({ ok: true });
    expect((await send('GET', '/exams')).json()).toEqual([]);
  });

  it('keeps an exam and its class list protected from each other', async () => {
    const list = await importList();
    await createExam({ title: 'x', durationMin: 5, classListId: list.id });
    expect((await send('DELETE', `/class-lists/${list.id}`)).json().error.code).toBe('list_in_use');
  });
});

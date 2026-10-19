import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase } from '../db/database.js';
import type { Db } from '../db/connection.js';
import { buildTeacherApp } from './teacher-app.js';

const TOKEN = 't'.repeat(40);
const HEADERS = { 'x-teacher-token': TOKEN };
const CSV = 'id,name\n1,Ada\n,Bob\n2,Alan\n1,Dup\n';

let app: FastifyInstance;
let db: Db;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'eg-cl-'));
  db = initDatabase(dir);
  app = buildTeacherApp({ token: TOKEN, db, now: () => 5000 }).app;
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

const importCsv = (payload: object) =>
  app.inject({ method: 'POST', url: '/api/v1/class-lists/import', headers: HEADERS, payload });
const get = (url: string) => app.inject({ url: `/api/v1${url}`, headers: HEADERS });
const count = (table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('class list routes', () => {
  it('needs a login', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: HEADERS });
    expect((await get('/class-lists')).statusCode).toBe(401);
    expect((await get('/class-lists')).json().error.code).toBe('login_required');
  });

  it('dry run returns the preview and writes nothing', async () => {
    const res = await importCsv({ name: 'CSE', csvText: CSV, dryRun: true });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.list).toBeUndefined();
    expect(body.rows).toHaveLength(2);
    expect(body.errors.map((e: { code: string }) => e.code)).toEqual(['blank_id', 'duplicate_id']);
    expect(count('class_lists')).toBe(0);
  });

  it('imports the valid rows and reports the rest', async () => {
    const res = await importCsv({ name: ' CSE 101 ', csvText: CSV });
    const body = res.json();
    expect(body.list).toMatchObject({ name: 'CSE 101', studentCount: 2, createdAt: 5000 });
    expect(body.errors).toHaveLength(2);

    expect((await get('/class-lists')).json()).toEqual([body.list]);
    const students = (await get(`/class-lists/${body.list.id}/students`)).json();
    expect(students).toEqual([
      { studentCode: '1', name: 'Ada' },
      { studentCode: '2', name: 'Alan' },
    ]);
  });

  it('rejects bad bodies and files with no valid rows', async () => {
    expect((await importCsv({ name: '', csvText: CSV })).statusCode).toBe(400);
    const empty = await importCsv({ name: 'x', csvText: 'id,name\n,Bob\n' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe('no_valid_rows');
    expect(empty.json().error.details.errors).toHaveLength(1);
    expect(count('class_lists')).toBe(0);
  });

  it('returns 404 for the students of an unknown list', async () => {
    expect((await get('/class-lists/nope/students')).statusCode).toBe(404);
  });

  it('deletes a list and its students', async () => {
    const { list } = (await importCsv({ name: 'x', csvText: CSV })).json();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/class-lists/${list.id}`,
      headers: HEADERS,
    });
    expect(res.json()).toEqual({ ok: true });
    expect(count('class_lists')).toBe(0);
    expect(count('class_students')).toBe(0);
  });

  it('answers 404 when deleting an unknown list', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/class-lists/nope',
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses to delete a list that is in use (exams.class_list_id is RESTRICT)', async () => {
    // The exams table arrives in M07; a table with the same foreign key stands in for it.
    db.exec(
      'CREATE TABLE exams (id TEXT PRIMARY KEY, class_list_id TEXT REFERENCES class_lists (id) ON DELETE RESTRICT)',
    );
    const { list } = (await importCsv({ name: 'x', csvText: CSV })).json();
    db.prepare('INSERT INTO exams (id, class_list_id) VALUES (?, ?)').run('e1', list.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/class-lists/${list.id}`,
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('list_in_use');
    expect(count('class_students')).toBe(2);
  });
});

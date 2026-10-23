import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXAM_FILE_LIMITS } from '@examguard/shared';
import type { Db } from '../db/connection.js';
import { initDatabase } from '../db/database.js';
import { buildTeacherApp } from './teacher-app.js';

const TOKEN = 't'.repeat(40);
const HEADERS = { 'x-teacher-token': TOKEN };

let app: FastifyInstance;
let db: Db;
let dir: string;
let filesDir: string;
let clock = 1000;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'eg-xf-'));
  filesDir = join(dir, 'exam-files');
  db = initDatabase(dir);
  clock = 1000;
  app = buildTeacherApp({ token: TOKEN, db, filesDir, now: () => clock++ }).app;
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

const json = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: HEADERS, payload });
const createExam = async () =>
  (await json('POST', '/exams', { title: 'Midterm', durationMin: 90 })).json().id as string;
const upload = (examId: string, name: string, data: Buffer | string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/exams/${examId}/files?name=${encodeURIComponent(name)}`,
    headers: { ...HEADERS, 'content-type': 'application/octet-stream' },
    payload: typeof data === 'string' ? Buffer.from(data) : data,
  });
const onDisk = (examId: string, fileId: string) => join(filesDir, examId, fileId);

describe('exam file routes', () => {
  it('stores an upload, lists it, and keeps the bytes on disk', async () => {
    const examId = await createExam();
    const res = await upload(examId, 'data.csv', 'a,b\n1,2\n');
    expect(res.statusCode).toBe(201);
    const file = res.json();
    expect(file).toMatchObject({ name: 'data.csv', size: 8 });
    expect(file.sha256).toBe(createHash('sha256').update('a,b\n1,2\n').digest('hex'));
    expect((await json('GET', `/exams/${examId}/files`)).json()).toEqual([file]);
    expect(readFileSync(onDisk(examId, file.id), 'utf8')).toBe('a,b\n1,2\n');
  });

  it('keeps binary bytes exactly, and accepts an empty file', async () => {
    const examId = await createExam();
    const bytes = Buffer.from([0, 255, 1, 254, 137, 80, 78, 71]);
    const file = (await upload(examId, 'logo.png', bytes)).json();
    expect(readFileSync(onDisk(examId, file.id)).equals(bytes)).toBe(true);
    const empty = await upload(examId, 'empty.txt', Buffer.alloc(0));
    expect(empty.statusCode).toBe(201);
    expect(empty.json().size).toBe(0);
  });

  it('replaces a file with the same name, in any letter case', async () => {
    const examId = await createExam();
    const first = (await upload(examId, 'data.csv', 'old')).json();
    const second = (await upload(examId, 'DATA.csv', 'newer')).json();
    const list = (await json('GET', `/exams/${examId}/files`)).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: second.id, name: 'DATA.csv', size: 5 });
    expect(existsSync(onDisk(examId, first.id))).toBe(false);
    expect(readFileSync(onDisk(examId, second.id), 'utf8')).toBe('newer');
  });

  it.each(['a/b', 'a\\b', 'x?.txt', 'nul', 'trail.', ''])('refuses the name %j', async (name) => {
    const examId = await createExam();
    const res = await upload(examId, name, 'x');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_name');
    expect(await (await json('GET', `/exams/${examId}/files`)).json()).toEqual([]);
  });

  it('refuses a file over the limit, whether just over or far over', async () => {
    const examId = await createExam();
    for (const extra of [1, 1024]) {
      const res = await upload(examId, 'big.bin', Buffer.alloc(EXAM_FILE_LIMITS.fileBytes + extra));
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe('file_too_large');
    }
    const atLimit = await upload(examId, 'edge.bin', Buffer.alloc(EXAM_FILE_LIMITS.fileBytes));
    expect(atLimit.statusCode).toBe(201);
  }, 30_000);

  it('refuses files past the total size, but a replacement counts only the difference', async () => {
    const examId = await createExam();
    const half = EXAM_FILE_LIMITS.totalBytes / 2;
    expect((await upload(examId, 'a.bin', Buffer.alloc(half))).statusCode).toBe(201);
    expect((await upload(examId, 'b.bin', Buffer.alloc(half))).statusCode).toBe(201);
    const over = await upload(examId, 'c.bin', Buffer.alloc(1));
    expect(over.statusCode).toBe(413);
    expect(over.json().error.code).toBe('exam_files_full');
    // Swapping a.bin for a smaller file frees room.
    expect((await upload(examId, 'a.bin', Buffer.alloc(10))).statusCode).toBe(201);
    expect((await upload(examId, 'c.bin', Buffer.alloc(10))).statusCode).toBe(201);
  }, 30_000);

  it('refuses a 51st file', async () => {
    const examId = await createExam();
    for (let i = 0; i < EXAM_FILE_LIMITS.count; i++) {
      expect((await upload(examId, `f${i}.txt`, 'x')).statusCode).toBe(201);
    }
    const res = await upload(examId, 'one-too-many.txt', 'x');
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('exam_files_full');
    // Replacing an existing name is still fine at the limit.
    expect((await upload(examId, 'f0.txt', 'y')).statusCode).toBe(201);
  }, 30_000);

  it('deletes a file and its bytes', async () => {
    const examId = await createExam();
    const file = (await upload(examId, 'a.txt', 'x')).json();
    expect((await json('DELETE', `/exams/${examId}/files/${file.id}`)).json()).toEqual({
      ok: true,
    });
    expect(existsSync(onDisk(examId, file.id))).toBe(false);
    expect((await json('GET', `/exams/${examId}/files`)).json()).toEqual([]);
    expect((await json('DELETE', `/exams/${examId}/files/${file.id}`)).statusCode).toBe(404);
  });

  it('answers 404 for an unknown exam', async () => {
    expect((await json('GET', '/exams/nope/files')).statusCode).toBe(404);
    expect((await upload('nope', 'a.txt', 'x')).statusCode).toBe(404);
    expect((await json('DELETE', '/exams/nope/files/x')).statusCode).toBe(404);
  });

  it('allows changes in ready, and refuses them once the exam is past ready', async () => {
    const examId = await createExam();
    const file = (await upload(examId, 'a.txt', 'x')).json();
    db.prepare("UPDATE exams SET state = 'ready' WHERE id = ?").run(examId);
    expect((await upload(examId, 'b.txt', 'x')).statusCode).toBe(201);
    db.prepare("UPDATE exams SET state = 'hosting' WHERE id = ?").run(examId);
    const blocked = await upload(examId, 'c.txt', 'x');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('invalid_state');
    expect((await json('DELETE', `/exams/${examId}/files/${file.id}`)).statusCode).toBe(409);
    // Reading the list is always fine.
    expect((await json('GET', `/exams/${examId}/files`)).json()).toHaveLength(2);
  });

  it('needs the teacher login', async () => {
    const examId = await createExam();
    await json('POST', '/auth/logout');
    expect((await json('GET', `/exams/${examId}/files`)).statusCode).toBe(401);
    expect((await upload(examId, 'a.txt', 'x')).statusCode).toBe(401);
  });

  it('gives a duplicated exam its own copy of the files', async () => {
    const examId = await createExam();
    const original = (await upload(examId, 'data.csv', 'rows')).json();
    const copyId = (await json('POST', `/exams/${examId}/duplicate`)).json().id as string;
    const copied = (await json('GET', `/exams/${copyId}/files`)).json();
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatchObject({ name: 'data.csv', sha256: original.sha256, size: 4 });
    expect(copied[0].id).not.toBe(original.id);
    expect(readFileSync(onDisk(copyId, copied[0].id), 'utf8')).toBe('rows');
    // Changing the copy leaves the original alone.
    await json('DELETE', `/exams/${copyId}/files/${copied[0].id}`);
    expect(readFileSync(onDisk(examId, original.id), 'utf8')).toBe('rows');
  });

  it('removes the exam folder when the exam is deleted', async () => {
    const examId = await createExam();
    await upload(examId, 'a.txt', 'x');
    expect(existsSync(join(filesDir, examId))).toBe(true);
    expect((await json('DELETE', `/exams/${examId}`)).statusCode).toBe(200);
    expect(existsSync(join(filesDir, examId))).toBe(false);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM exam_files').get() as { n: number };
    expect(rows.n).toBe(0);
  });
});

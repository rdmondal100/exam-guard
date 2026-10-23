import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/connection.js';
import { initDatabase } from '../db/database.js';
import type { HostingManager } from '../hosting/hosting-manager.js';
import { buildTeacherApp } from '../http/teacher-app.js';

const TOKEN = 't'.repeat(40);
const HEADERS = { 'x-teacher-token': TOKEN };
const PROTOCOL = { major: 1, minor: 0 };
const CSV = 'a,b\n1,2\n';
const PNG = Buffer.from([137, 80, 78, 71, 0, 255, 0, 1]);

let app: FastifyInstance;
let hosting: HostingManager;
let db: Db;
let dir: string;
let studentPort: number;
let examId: string;
let otherFileId: string;
let csvId: string;
let token: string;

const call = (url: string, payload?: object) =>
  app.inject({ method: 'POST', url: `/api/v1${url}`, headers: HEADERS, payload });
const upload = async (id: string, name: string, data: Buffer | string) =>
  (
    await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${id}/files?name=${encodeURIComponent(name)}`,
      headers: { ...HEADERS, 'content-type': 'application/octet-stream' },
      payload: typeof data === 'string' ? Buffer.from(data) : data,
    })
  ).json().id as string;

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/** A student call over the real HTTPS listener (the cert is self-signed). */
function studentRequest(
  method: 'GET' | 'POST',
  path: string,
  bearerToken?: string,
  json?: object,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = json ? JSON.stringify(json) : undefined;
    const req = request(
      {
        host: '127.0.0.1',
        port: studentPort,
        path: `/api/v1${path}`,
        method,
        rejectUnauthorized: false,
        headers: {
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
          ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'eg-xfd-'));
  db = initDatabase(dir);
  const built = buildTeacherApp({
    token: TOKEN,
    db,
    hosting: {
      dataDir: dir,
      host: '127.0.0.1',
      port: 0,
      makePin: () => '004217',
      addresses: () => ['127.0.0.1'],
      advertise: () => () => {},
    },
  });
  app = built.app;
  hosting = built.hosting as HostingManager;
  await app.listen({ host: '127.0.0.1', port: 0 });
  await call('/auth/setup', { password: 'correct horse battery' });
  const list = (
    await call('/class-lists/import', { name: 'CSE', csvText: '1,Ada\n2,Bob\n' })
  ).json().list;
  examId = (await call('/exams', { title: 'Mid', durationMin: 60, classListId: list.id })).json()
    .id;
  await call(`/exams/${examId}/questions`, {
    type: 'written',
    body: 'Explain a stack',
    allowedLanguages: [],
    studentNote: '',
    sampleAnswer: 'LIFO',
    sampleLanguage: 'text',
    aiNotes: '',
    criteria: [{ name: 'Accuracy', maxMarks: 2 }],
  });
  csvId = await upload(examId, 'data.csv', CSV);
  await upload(examId, 'logo.png', PNG);
  // A file of another exam, which this exam's students must not be able to fetch.
  const other = (await call('/exams', { title: 'Other', durationMin: 10 })).json().id as string;
  otherFileId = await upload(other, 'secret.txt', 'not yours');
  await call(`/exams/${examId}/ready`);
  studentPort = (await call(`/exams/${examId}/host`)).json().port;
  const joined = await studentRequest('POST', '/join', undefined, {
    studentCode: '1',
    pin: '004217',
    deviceId: 'device-1-aaaa',
    protocol: PROTOCOL,
    agent: { ok: true, helper: true, captureOk: true, monitors: 1 },
  });
  token = (JSON.parse(joined.body.toString()) as { token: string }).token;
  await studentRequest('POST', '/join/confirm', token, { noticeAccepted: true });
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const studentId = () => (db.prepare('SELECT id FROM exam_students').get() as { id: string }).id;

describe('exam file download', () => {
  it('streams the file with its size and hash', async () => {
    const res = await studentRequest('GET', `/exam-files/${csvId}`, token);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe(CSV);
    expect(res.headers['content-length']).toBe(String(CSV.length));
    expect(res.headers['x-sha256']).toBe(createHash('sha256').update(CSV).digest('hex'));
  });

  it('keeps binary bytes exactly', async () => {
    const manifest = hosting.sessionState(studentId()).examFiles;
    const logo = manifest.find((f) => f.name === 'logo.png');
    const res = await studentRequest('GET', `/exam-files/${logo?.id ?? ''}`, token);
    expect(res.status).toBe(200);
    expect(res.body.equals(PNG)).toBe(true);
  });

  it('needs a valid session token', async () => {
    expect((await studentRequest('GET', `/exam-files/${csvId}`)).status).toBe(401);
    expect((await studentRequest('GET', `/exam-files/${csvId}`, 'not-a-token')).status).toBe(401);
  });

  it('does not give out unknown files or another exam’s files', async () => {
    expect((await studentRequest('GET', '/exam-files/nope', token)).status).toBe(404);
    expect((await studentRequest('GET', `/exam-files/${otherFileId}`, token)).status).toBe(404);
  });

  it('is closed when the teacher turned Files off', async () => {
    db.prepare('UPDATE exams SET files_enabled = 0 WHERE id = ?').run(examId);
    const res = await studentRequest('GET', `/exam-files/${csvId}`, token);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body.toString()).error.code).toBe('files_off');
  });

  it('is closed once the exam is over', async () => {
    db.prepare("UPDATE exams SET state = 'ended' WHERE id = ?").run(examId);
    expect((await studentRequest('GET', `/exam-files/${csvId}`, token)).status).toBe(409);
  });

  it('answers 404 when the bytes are gone from disk', async () => {
    rmSync(join(dir, 'exam-files', examId, csvId));
    const res = await studentRequest('GET', `/exam-files/${csvId}`, token);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body.toString()).error.code).toBe('file_missing');
  });
});

describe('session state manifest', () => {
  it('lists the exam files, in the order they were attached', () => {
    const files = hosting.sessionState(studentId()).examFiles;
    expect(files.map((f) => f.name)).toEqual(['data.csv', 'logo.png']);
    expect(files[0]).toMatchObject({
      id: csvId,
      size: CSV.length,
      sha256: createHash('sha256').update(CSV).digest('hex'),
    });
  });

  it('is empty when the teacher turned Files off', () => {
    db.prepare('UPDATE exams SET files_enabled = 0 WHERE id = ?').run(examId);
    expect(hosting.sessionState(studentId()).examFiles).toEqual([]);
  });
});

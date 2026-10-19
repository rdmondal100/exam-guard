import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { request } from 'node:https';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase } from '../db/database.js';
import type { Db } from '../db/connection.js';
import type { HostingManager } from '../hosting/hosting-manager.js';
import { buildTeacherApp } from './teacher-app.js';

const TOKEN = 't'.repeat(40);
const HEADERS = { 'x-teacher-token': TOKEN };

let app: FastifyInstance;
let hosting: HostingManager;
let db: Db;
let dir: string;
let clock = 1000;
let active: boolean[];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'eg-host-'));
  db = initDatabase(dir);
  clock = 1000;
  active = [];
  const built = buildTeacherApp({
    token: TOKEN,
    db,
    now: () => clock++,
    hosting: {
      dataDir: dir,
      host: '127.0.0.1',
      port: 0,
      onActive: (a) => active.push(a),
      addresses: () => ['192.168.1.7'],
      makePin: () => '004217',
    },
  });
  app = built.app;
  hosting = built.hosting as HostingManager;
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

const question = {
  type: 'written',
  body: 'Explain a stack',
  allowedLanguages: [],
  studentNote: '',
  sampleAnswer: 'LIFO',
  sampleLanguage: 'text',
  aiNotes: '',
  criteria: [{ name: 'Accuracy', maxMarks: 2 }],
};

/** A ready exam (class list + one complete question). */
async function readyExam(title = 'Mid') {
  const imported = await send('POST', '/class-lists/import', { name: 'CSE', csvText: '1,Ada\n' });
  const list = imported.json().list;
  const exam = (
    await send('POST', '/exams', { title, durationMin: 60, classListId: list.id })
  ).json();
  await send('POST', `/exams/${exam.id}/questions`, question);
  await send('POST', `/exams/${exam.id}/ready`);
  return exam as { id: string };
}

/** GET /api/v1/info over TLS, ignoring the self-signed cert. */
function getInfo(port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/v1/info',
        rejectUnauthorized: false,
        agent: false,
      },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('hosting routes', () => {
  it('hosts a ready exam: PIN, addresses, code, and /info over TLS', async () => {
    const exam = await readyExam();
    const res = await send('POST', `/exams/${exam.id}/host`);
    expect(res.statusCode).toBe(200);
    const info = res.json();
    expect(info).toMatchObject({ pin: '004217', addresses: ['192.168.1.7'] });
    expect(info.fpCode).toMatch(/^[0-9A-Z]{4}$/);
    expect(active).toEqual([true]);

    const student = await getInfo(info.port);
    expect(student.status).toBe(200);
    expect(JSON.parse(student.body)).toEqual({
      examTitle: 'Mid',
      protocol: { major: 1, minor: 0 },
      state: 'hosting',
      fpCode: info.fpCode,
    });

    expect((await send('GET', `/exams/${exam.id}`)).json().state).toBe('hosting');
    const row = db.prepare('SELECT pin FROM exams WHERE id = ?').get(exam.id);
    expect(row).toEqual({ pin: '004217' });
    expect((await send('GET', `/exams/${exam.id}/hosting`)).json()).toEqual(info);
  });

  it('stops hosting: listener refused, exam back to ready, PIN cleared', async () => {
    const exam = await readyExam();
    const { port } = (await send('POST', `/exams/${exam.id}/host`)).json();
    const res = await send('POST', `/exams/${exam.id}/stop-hosting`);
    expect(res.json()).toEqual({ ok: true });
    await expect(getInfo(port)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect((await send('GET', `/exams/${exam.id}`)).json().state).toBe('ready');
    const row = db.prepare('SELECT pin FROM exams WHERE id = ?').get(exam.id);
    expect(row).toEqual({ pin: null });
    expect((await send('GET', `/exams/${exam.id}/hosting`)).statusCode).toBe(404);
    expect(active).toEqual([true, false]);
  });

  it('refuses a draft exam, an unknown exam and a second hosted exam', async () => {
    const draft = (await send('POST', '/exams', { title: 'D', durationMin: 5 })).json();
    const res = await send('POST', `/exams/${draft.id}/host`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('invalid_state');
    expect((await send('POST', '/exams/nope/host')).statusCode).toBe(404);

    const first = await readyExam('One');
    const second = await readyExam('Two');
    expect((await send('POST', `/exams/${first.id}/host`)).statusCode).toBe(200);
    const again = await send('POST', `/exams/${second.id}/host`);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('already_hosting');
  });

  it('re-checks readiness when hosting starts', async () => {
    const exam = await readyExam();
    const [q] = (await send('GET', `/exams/${exam.id}/questions`)).json();
    await send('PATCH', `/questions/${q.id}`, { ...question, criteria: [] });
    const res = await send('POST', `/exams/${exam.id}/host`);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.problems[0].code).toBe('no_criteria');
    expect((await send('GET', `/exams/${exam.id}`)).json().state).toBe('ready');
    expect(active).toEqual([]);
  });

  it('refuses stop on an exam that is not hosted', async () => {
    const exam = await readyExam();
    const res = await send('POST', `/exams/${exam.id}/stop-hosting`);
    expect(res.statusCode).toBe(409);
  });

  it('needs a login', async () => {
    const exam = await readyExam();
    await send('POST', '/auth/logout');
    expect((await send('POST', `/exams/${exam.id}/host`)).statusCode).toBe(401);
    expect((await send('POST', `/exams/${exam.id}/stop-hosting`)).statusCode).toBe(401);
    expect((await send('GET', `/exams/${exam.id}/hosting`)).statusCode).toBe(401);
  });

  it('resume reopens the listener for an exam still in hosting, same PIN and code', async () => {
    const exam = await readyExam();
    const first = (await send('POST', `/exams/${exam.id}/host`)).json();
    await hosting.close(); // the server process going away
    expect(hosting.info(exam.id)).toBeNull();
    await hosting.resume();
    const again = hosting.info(exam.id);
    expect(again).toMatchObject({ pin: '004217', fpCode: first.fpCode });
    expect((await getInfo(again?.port ?? 0)).status).toBe(200);
  });
});

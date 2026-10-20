import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/connection.js';
import { initDatabase } from '../db/database.js';
import type { HostingManager } from '../hosting/hosting-manager.js';
import { buildTeacherApp } from '../http/teacher-app.js';

const TOKEN = 't'.repeat(40);
const HEADERS = { 'x-teacher-token': TOKEN };
const PROTOCOL = { major: 1, minor: 0 };

interface Entry {
  studentCode: string;
  name: string;
  state: string;
  connected: boolean;
}
interface Msg {
  t: string;
  students?: Entry[];
  joined?: number;
  inLobby?: number;
  connected?: number;
  clientSent?: number;
  serverTime?: number;
  state?: { studentState: string; locked: boolean; deadline: number | null };
}

let app: FastifyInstance;
let hosting: HostingManager;
let db: Db;
let dir: string;
let teacherPort: number;
let studentPort: number;
let examId: string;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'eg-ws-'));
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
      socketTimings: { helloTimeoutMs: 300, idleMs: 600 },
    },
  });
  app = built.app;
  hosting = built.hosting as HostingManager;
  await app.listen({ host: '127.0.0.1', port: 0 });
  teacherPort = (app.server.address() as { port: number }).port;
  const call = (url: string, payload?: object) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, headers: HEADERS, payload });
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
  await call(`/exams/${examId}/ready`);
  studentPort = (await call(`/exams/${examId}/host`)).json().port;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function post(path: string, body: object, token?: string): Promise<{ token?: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port: studentPort,
        path: `/api/v1${path}`,
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c.toString()));
        res.on('end', () => resolve(JSON.parse(text) as { token?: string }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

/** Joins and accepts the notice, returning the session token. */
async function joinStudent(code: string): Promise<string> {
  const joined = await post('/join', {
    studentCode: code,
    pin: '004217',
    deviceId: `device-${code}-aaaa`,
    protocol: PROTOCOL,
    agent: { ok: true, helper: true, captureOk: true, monitors: 1 },
  });
  const token = joined.token ?? '';
  await post('/join/confirm', { noticeAccepted: true }, token);
  return token;
}

interface Client {
  ws: WebSocket;
  messages: Msg[];
  closed: Promise<number>;
  waitFor(match: () => boolean, ms?: number): Promise<void>;
}

function client(url: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { rejectUnauthorized: false });
    sockets.push(ws);
    const messages: Msg[] = [];
    const checks = new Set<() => void>();
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()) as Msg);
      for (const check of [...checks]) check();
    });
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        ws,
        messages,
        closed,
        waitFor: (match, ms = 2000) =>
          new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error('timed out waiting for a message')), ms);
            const check = () => {
              if (!match()) return;
              clearTimeout(timer);
              checks.delete(check);
              res();
            };
            checks.add(check);
            check();
          }),
      }),
    );
  });
}

const studentWs = () => client(`wss://127.0.0.1:${studentPort}/ws`);
const hello = (token: string, protocol = PROTOCOL) =>
  JSON.stringify({ t: 'hello', token, protocol, resume: { lastServerSeq: 0 } });
const has = (c: Client, t: string) => c.messages.some((m) => m.t === t);
const last = (c: Client, t: string) => [...c.messages].reverse().find((m) => m.t === t);

async function teacherWs(): Promise<Client> {
  const c = await client(`ws://127.0.0.1:${teacherPort}/ws?token=${TOKEN}`);
  c.ws.send(JSON.stringify({ t: 'subscribe', examId }));
  await c.waitFor(() => has(c, 'hosting'));
  return c;
}

const entry = (c: Client, code: string): Entry | undefined =>
  [...c.messages]
    .reverse()
    .flatMap((m) => m.students ?? [])
    .find((s) => s.studentCode === code);

describe('student socket', () => {
  it('answers hello with welcome and ping with pong', async () => {
    const token = await joinStudent('1');
    const c = await studentWs();
    c.ws.send(hello(token));
    await c.waitFor(() => has(c, 'welcome'));
    expect(last(c, 'welcome')?.state).toMatchObject({
      studentState: 'lobby',
      locked: false,
      deadline: null,
    });
    expect(typeof last(c, 'welcome')?.serverTime).toBe('number');
    c.ws.send(JSON.stringify({ t: 'ping', clientSent: 42 }));
    await c.waitFor(() => has(c, 'pong'));
    expect(last(c, 'pong')?.clientSent).toBe(42);
  });

  it('refuses an unknown token', async () => {
    const c = await studentWs();
    c.ws.send(hello('x'.repeat(30)));
    expect(await c.closed).toBe(4401);
  });

  it('refuses another protocol major', async () => {
    const token = await joinStudent('1');
    const c = await studentWs();
    c.ws.send(hello(token, { major: 2, minor: 0 }));
    expect(await c.closed).toBe(4426);
  });

  it('closes a socket that sends no hello', async () => {
    const c = await studentWs();
    expect(await c.closed).toBe(4400);
  });

  it('refuses a ping before hello', async () => {
    const c = await studentWs();
    c.ws.send(JSON.stringify({ t: 'ping', clientSent: 1 }));
    expect(await c.closed).toBe(4400);
  });

  it('drops a silent socket and marks the student disconnected', async () => {
    const token = await joinStudent('1');
    const teacher = await teacherWs();
    const c = await studentWs();
    c.ws.send(hello(token));
    await teacher.waitFor(() => entry(teacher, '1')?.connected === true);
    await c.closed;
    await teacher.waitFor(() => entry(teacher, '1')?.connected === false);
  });

  it('replaces an older socket of the same student', async () => {
    const token = await joinStudent('1');
    const first = await studentWs();
    first.ws.send(hello(token));
    await first.waitFor(() => has(first, 'welcome'));
    const second = await studentWs();
    second.ws.send(hello(token));
    await second.waitFor(() => has(second, 'welcome'));
    expect(await first.closed).toBe(4409);
    const row = db.prepare('SELECT connected FROM exam_students').get() as { connected: number };
    expect(row.connected).toBe(1);
  });

  it('closes sockets when hosting stops', async () => {
    const token = await joinStudent('1');
    const c = await studentWs();
    c.ws.send(hello(token));
    await c.waitFor(() => has(c, 'welcome'));
    await hosting.stop(examId);
    expect(await c.closed).toBe(4503);
    const row = db.prepare('SELECT connected FROM exam_students').get() as { connected: number };
    expect(row.connected).toBe(0);
  });
});

describe('teacher socket', () => {
  it('closes a socket with a bad token', async () => {
    const c = await client(`ws://127.0.0.1:${teacherPort}/ws?token=nope`);
    expect(await c.closed).toBe(4401);
  });

  it('sends the full roster on subscribe', async () => {
    await joinStudent('1');
    const teacher = await teacherWs();
    expect(entry(teacher, '1')).toMatchObject({ name: 'Ada', state: 'lobby', connected: false });
    expect(last(teacher, 'hosting')).toMatchObject({ joined: 1, inLobby: 1, connected: 0 });
  });

  it('pushes a student who joins and connects within a second', async () => {
    const teacher = await teacherWs();
    const started = Date.now();
    const token = await joinStudent('2');
    await teacher.waitFor(() => entry(teacher, '2')?.state === 'lobby');
    const c = await studentWs();
    c.ws.send(hello(token));
    await teacher.waitFor(() => entry(teacher, '2')?.connected === true);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(last(teacher, 'hosting')).toMatchObject({ joined: 1, connected: 1 });
  });

  it('serves the roster snapshot over HTTP', async () => {
    await joinStudent('1');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/roster`,
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().counts).toMatchObject({ joined: 1, connected: 0 });
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/exams/nope/roster',
      headers: HEADERS,
    });
    expect(missing.statusCode).toBe(404);
  });
});

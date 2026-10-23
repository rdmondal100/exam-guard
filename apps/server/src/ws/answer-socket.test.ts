import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnswerRepo } from '../db/answer-repo.js';
import type { Db } from '../db/connection.js';
import { initDatabase } from '../db/database.js';
import { buildTeacherApp } from '../http/teacher-app.js';

const TOKEN = 't'.repeat(40);
const HEADERS = { 'x-teacher-token': TOKEN };
const PROTOCOL = { major: 1, minor: 0 };

interface Msg {
  t: string;
  id?: string;
  clientSeq?: number;
  state?: {
    saved: { questionId: string; language: string; clientSeq: number; selected: boolean }[];
  };
}

let app: FastifyInstance;
let db: Db;
let dir: string;
let studentPort: number;
let examId: string;
let writtenId: string;
let codeId: string;
const sockets: WebSocket[] = [];

const question = (type: 'written' | 'code', allowedLanguages: string[]) => ({
  type,
  body: 'Q',
  allowedLanguages,
  studentNote: '',
  sampleAnswer: 'x',
  sampleLanguage: type === 'code' ? 'c' : 'text',
  aiNotes: '',
  criteria: [{ name: 'Accuracy', maxMarks: 2 }],
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'eg-ans-'));
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
      networkGraceMs: 150,
    },
  });
  app = built.app;
  await app.listen({ host: '127.0.0.1', port: 0 });
  const call = (url: string, payload?: object) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, headers: HEADERS, payload });
  await call('/auth/setup', { password: 'correct horse battery' });
  const list = (
    await call('/class-lists/import', { name: 'CSE', csvText: '1,Ada\n2,Bob\n' })
  ).json().list;
  examId = (await call('/exams', { title: 'Mid', durationMin: 60, classListId: list.id })).json()
    .id;
  writtenId = (await call(`/exams/${examId}/questions`, question('written', []))).json().id;
  codeId = (await call(`/exams/${examId}/questions`, question('code', ['c', 'cpp']))).json().id;
  await call(`/exams/${examId}/ready`);
  studentPort = (await call(`/exams/${examId}/host`)).json().port;
  await call(`/exams/${examId}/start`);
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

function get(path: string, token?: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: studentPort,
        path: `/api/v1${path}`,
        method: 'GET',
        rejectUnauthorized: false,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      },
      (res) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c.toString()));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as unknown }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  waitFor(match: () => boolean, ms?: number): Promise<void>;
}

/** Opens the student socket, says hello and waits for the welcome. */
function connect(token: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://127.0.0.1:${studentPort}/ws`, { rejectUnauthorized: false });
    sockets.push(ws);
    const messages: Msg[] = [];
    const checks = new Set<() => void>();
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()) as Msg);
      for (const check of [...checks]) check();
    });
    ws.on('error', reject);
    const client: Client = {
      ws,
      messages,
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
    };
    ws.on('open', () => {
      ws.send(
        JSON.stringify({ t: 'hello', token, protocol: PROTOCOL, resume: { lastServerSeq: 0 } }),
      );
      void client
        .waitFor(() => messages.some((m) => m.t === 'welcome'))
        .then(() => resolve(client), reject);
    });
  });
}

const save = (clientSeq: number, over: Record<string, unknown> = {}) => ({
  t: 'answer.save',
  id: `s${clientSeq}`,
  clientSeq,
  clientTs: 1000 + clientSeq,
  questionId: codeId,
  language: 'c',
  content: `v${clientSeq}`,
  selected: true,
  reason: 'interval',
  ...over,
});
const acks = (c: Client) => c.messages.filter((m) => m.t === 'answer.ack').map((m) => m.clientSeq);

describe('answer.save over the student socket', () => {
  it('stores a save, acks it after the commit, and ignores a resend', async () => {
    const c = await connect(await joinStudent('1'));
    c.ws.send(JSON.stringify(save(1)));
    await c.waitFor(() => acks(c).includes(1));
    c.ws.send(JSON.stringify(save(1, { content: 'changed' })));
    await c.waitFor(() => acks(c).length === 2);
    const rows = new AnswerRepo(db).list(
      (db.prepare('SELECT id FROM exam_students LIMIT 1').get() as { id: string }).id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      language: 'c',
      content: 'v1',
      selected: true,
      reason: 'interval',
    });
  });

  it('keeps each language as its own version and says which one is selected', async () => {
    const c = await connect(await joinStudent('1'));
    c.ws.send(JSON.stringify(save(1, { language: 'c', content: 'int c;' })));
    c.ws.send(
      JSON.stringify(save(2, { language: 'cpp', content: 'int cpp;', reason: 'switch_language' })),
    );
    c.ws.send(JSON.stringify(save(3, { language: 'c', content: 'int c2;', selected: false })));
    await c.waitFor(() => acks(c).length === 3);

    const second = await connect(await joinStudent('1'));
    expect(second.messages.find((m) => m.t === 'welcome')?.state?.saved).toEqual(
      expect.arrayContaining([
        { questionId: codeId, language: 'c', clientSeq: 3, selected: false },
        { questionId: codeId, language: 'cpp', clientSeq: 2, selected: true },
      ]),
    );
  });

  it('stores a written answer under "text"', async () => {
    const c = await connect(await joinStudent('1'));
    c.ws.send(
      JSON.stringify(save(1, { questionId: writtenId, language: 'text', content: 'LIFO' })),
    );
    await c.waitFor(() => acks(c).includes(1));
    const id = (db.prepare('SELECT id FROM exam_students LIMIT 1').get() as { id: string }).id;
    expect(new AnswerRepo(db).latest(id, writtenId, 'text')?.content).toBe('LIFO');
  });

  it.each([
    ['an unknown question', () => ({ questionId: 'nope' })],
    ['a language the question does not allow', () => ({ language: 'py' })],
    ['a code language on a written question', () => ({ questionId: writtenId, language: 'c' })],
  ])('acks but does not store %s', async (_name, over) => {
    const c = await connect(await joinStudent('1'));
    c.ws.send(JSON.stringify(save(1, over())));
    await c.waitFor(() => acks(c).includes(1));
    expect(db.prepare('SELECT COUNT(*) AS n FROM answer_versions').get()).toEqual({ n: 0 });
  });

  it('acks but does not store a save once the exam is no longer running', async () => {
    const c = await connect(await joinStudent('1'));
    db.prepare("UPDATE exams SET state = 'ended' WHERE id = ?").run(examId);
    c.ws.send(JSON.stringify(save(1)));
    await c.waitFor(() => acks(c).includes(1));
    expect(db.prepare('SELECT COUNT(*) AS n FROM answer_versions').get()).toEqual({ n: 0 });
  });

  it('keeps the sequence numbers of two students apart', async () => {
    const a = await connect(await joinStudent('1'));
    const b = await connect(await joinStudent('2'));
    a.ws.send(JSON.stringify(save(1, { content: 'ada' })));
    b.ws.send(JSON.stringify(save(1, { content: 'bob' })));
    await a.waitFor(() => acks(a).includes(1));
    await b.waitFor(() => acks(b).includes(1));
    expect(db.prepare('SELECT COUNT(*) AS n FROM answer_versions').get()).toEqual({ n: 2 });
  });
});

describe('resuming after a restart', () => {
  it('returns the newest content, flags and selected language for the token holder only', async () => {
    const token = await joinStudent('1');
    const c = await connect(token);
    c.ws.send(JSON.stringify(save(1, { language: 'c', content: 'int c;', flags: '-lm' })));
    c.ws.send(JSON.stringify(save(2, { language: 'cpp', content: 'int cpp;' })));
    c.ws.send(JSON.stringify(save(3, { language: 'c', content: 'int c2;', selected: false })));
    await c.waitFor(() => acks(c).length === 3);

    const other = await joinStudent('2');
    expect(await get('/answers/latest', other)).toEqual({
      status: 200,
      body: { buffers: [], selected: [] },
    });

    const { status, body } = await get('/answers/latest', token);
    expect(status).toBe(200);
    const snapshot = body as { buffers: object[]; selected: object[] };
    expect(snapshot.buffers).toEqual(
      expect.arrayContaining([
        { questionId: codeId, language: 'c', content: 'int c2;', flags: null, clientSeq: 3 },
        { questionId: codeId, language: 'cpp', content: 'int cpp;', flags: null, clientSeq: 2 },
      ]),
    );
    expect(snapshot.selected).toEqual([{ questionId: codeId, language: 'cpp', clientSeq: 2 }]);
  });

  it('refuses a missing or wrong token', async () => {
    expect((await get('/answers/latest')).status).toBe(401);
    expect((await get('/answers/latest', 'nope')).status).toBe(401);
  });

  it('records network_lost after the grace period and network_restored on reconnect', async () => {
    const token = await joinStudent('1');
    const first = await connect(token);
    first.ws.terminate();
    await sleep(500);
    const types = () =>
      (db.prepare('SELECT type FROM events ORDER BY id').all() as { type: string }[]).map(
        (r) => r.type,
      );
    expect(types()).toEqual(['network_lost']);
    await connect(token);
    expect(types()).toEqual(['network_lost', 'network_restored']);
  });

  it('records nothing when the student is back within the grace period', async () => {
    const token = await joinStudent('1');
    const first = await connect(token);
    first.ws.terminate();
    await connect(token);
    await sleep(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 0 });
  });
});

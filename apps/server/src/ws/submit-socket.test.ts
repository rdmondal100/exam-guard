import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MONITORING, buildReceiptAnswers } from '@examguard/shared';
import type { Db } from '../db/connection.js';
import { initDatabase } from '../db/database.js';
import { buildTeacherApp } from '../http/teacher-app.js';

const TOKEN = 't'.repeat(40);
const HEADERS = { 'x-teacher-token': TOKEN };
const PROTOCOL = { major: 1, minor: 0 };
const HOUR = 3_600_000;

interface Msg {
  t: string;
  id?: string;
  reason?: string;
  clientSeq?: number;
  receipt?: { hash: string; submittedAt: number; answers: { questionId: string }[] };
  state?: { studentState?: string; examState?: string; receipt?: Msg['receipt'] };
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

/** The 60-minute exam starts now; `graceSec` is the exam's time-up grace. */
async function setup(graceSec: number): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), 'eg-sub-'));
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
  await app.listen({ host: '127.0.0.1', port: 0 });
  const call = (url: string, payload?: object) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, headers: HEADERS, payload });
  await call('/auth/setup', { password: 'correct horse battery' });
  const list = (
    await call('/class-lists/import', { name: 'CSE', csvText: '1,Ada\n2,Bob\n' })
  ).json().list;
  examId = (
    await call('/exams', {
      title: 'Mid',
      durationMin: 60,
      classListId: list.id,
      monitoring: { ...DEFAULT_MONITORING, graceSec },
    })
  ).json().id;
  writtenId = (await call(`/exams/${examId}/questions`, question('written', []))).json().id;
  codeId = (await call(`/exams/${examId}/questions`, question('code', ['c', 'cpp']))).json().id;
  await call(`/exams/${examId}/ready`);
  studentPort = (await call(`/exams/${examId}/host`)).json().port;
}

const start = () =>
  app.inject({ method: 'POST', url: `/api/v1/exams/${examId}/start`, headers: HEADERS });

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
  send(message: object): void;
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
      send: (message) => ws.send(JSON.stringify(message)),
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
      client.send({ t: 'hello', token, protocol: PROTOCOL, resume: { lastServerSeq: 0 } });
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
  clientTs: Date.now(),
  questionId: writtenId,
  language: 'text',
  content: `answer ${clientSeq}`,
  selected: true,
  reason: 'interval',
  ...over,
});
const acked = (c: Client, seq: number) =>
  c.messages.some((m) => m.t === 'answer.ack' && m.clientSeq === seq);
const result = (c: Client) => c.messages.find((m) => m.t === 'submit.result');
const studentId = (code: string) =>
  (
    db
      .prepare(
        `SELECT s.id FROM exam_students s JOIN class_students c ON c.id = s.class_student_id
           WHERE c.student_code = ?`,
      )
      .get(code) as { id: string }
  ).id;
const studentRow = (code: string) =>
  db
    .prepare('SELECT state, submitted_at, submission_hash FROM exam_students WHERE id = ?')
    .get(studentId(code)) as {
    state: string;
    submitted_at: number | null;
    submission_hash: string | null;
  };
const finals = (code: string) =>
  db
    .prepare('SELECT * FROM final_answers WHERE exam_student_id = ? ORDER BY question_id')
    .all(studentId(code)) as { question_id: string; language: string; content: string }[];
const versionCount = (code: string) =>
  (
    db
      .prepare('SELECT COUNT(*) AS n FROM answer_versions WHERE exam_student_id = ?')
      .get(studentId(code)) as { n: number }
  ).n;
const examState = () =>
  (db.prepare('SELECT state FROM exams WHERE id = ?').get(examId) as { state: string }).state;
/** Moves the exam start so student deadlines fall `msAgo` ms in the past. */
const passDeadline = (msAgo: number) =>
  db.prepare('UPDATE exams SET started_at = ? WHERE id = ?').run(Date.now() - HOUR - msAgo, examId);

describe('submit', () => {
  beforeEach(async () => {
    await setup(60);
    await start();
  });

  it('flushes saves sent just before it and returns a receipt that matches the database', async () => {
    const c = await connect(await joinStudent('1'));
    c.send(save(1, { content: 'my essay' }));
    c.send({ t: 'submit', id: 'u1', clientTs: Date.now() });
    await c.waitFor(() => result(c) !== undefined);
    const receipt = result(c)?.receipt;
    const row = studentRow('1');
    expect(row.state).toBe('submitted');
    expect(receipt?.hash).toBe(row.submission_hash);
    expect(receipt?.submittedAt).toBe(row.submitted_at);

    const rows = finals('1');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.question_id === writtenId)).toMatchObject({
      language: 'text',
      content: 'my essay',
    });
    expect(rows.find((r) => r.question_id === codeId)).toMatchObject({
      language: 'c',
      content: '',
    });
    const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
    expect(receipt?.hash).toBe(
      buildReceiptAnswers(
        rows.map((r) => ({ questionId: r.question_id, language: r.language, content: r.content })),
        sha,
      ).hash,
    );
  });

  it('also pushes the final state with the receipt', async () => {
    const c = await connect(await joinStudent('1'));
    c.send({ t: 'submit', id: 'u1', clientTs: Date.now() });
    await c.waitFor(() =>
      c.messages.some((m) => m.t === 'state' && m.state?.studentState === 'submitted'),
    );
    const pushed = c.messages.find((m) => m.t === 'state')?.state?.receipt;
    expect(pushed?.hash).toBe(studentRow('1').submission_hash);
  });

  it('acks a later save but does not store it', async () => {
    const c = await connect(await joinStudent('1'));
    c.send(save(1));
    c.send({ t: 'submit', id: 'u1', clientTs: Date.now() });
    await c.waitFor(() => result(c) !== undefined);
    const before = versionCount('1');
    c.send(save(2, { content: 'too late' }));
    await c.waitFor(() => acked(c, 2));
    expect(versionCount('1')).toBe(before);
    expect(finals('1').find((r) => r.question_id === writtenId)?.content).toBe('answer 1');
  });

  it('answers a repeated submit with the same receipt and writes the rows once', async () => {
    const c = await connect(await joinStudent('1'));
    c.send(save(1));
    c.send({ t: 'submit', id: 'u1', clientTs: Date.now() });
    await c.waitFor(() => result(c) !== undefined);
    c.send({ t: 'submit', id: 'u2', clientTs: Date.now() });
    await c.waitFor(() => c.messages.filter((m) => m.t === 'submit.result').length === 2);
    const [a, b] = c.messages.filter((m) => m.t === 'submit.result');
    expect(b?.receipt).toEqual(a?.receipt);
    expect(finals('1')).toHaveLength(2);
  });

  it('gives a reconnecting student the receipt in the welcome', async () => {
    const token = await joinStudent('1');
    const first = await connect(token);
    first.send({ t: 'submit', id: 'u1', clientTs: Date.now() });
    await first.waitFor(() => result(first) !== undefined);
    const second = await connect(token);
    const welcome = second.messages.find((m) => m.t === 'welcome');
    expect(welcome?.state?.studentState).toBe('submitted');
    expect(welcome?.state?.receipt?.hash).toBe(studentRow('1').submission_hash);
  });

  it('keeps the answer in the language that was selected last', async () => {
    const c = await connect(await joinStudent('1'));
    c.send(save(1, { questionId: codeId, language: 'c', content: 'int c;' }));
    c.send(
      save(2, {
        questionId: codeId,
        language: 'cpp',
        content: 'int cpp;',
        reason: 'switch_language',
      }),
    );
    c.send({ t: 'submit', id: 'u1', clientTs: Date.now() });
    await c.waitFor(() => result(c) !== undefined);
    expect(finals('1').find((r) => r.question_id === codeId)).toMatchObject({
      language: 'cpp',
      content: 'int cpp;',
    });
  });

  it('refuses a submit from a student who is not working', async () => {
    const c = await connect(await joinStudent('1'));
    db.prepare("UPDATE exam_students SET state = 'lobby' WHERE id = ?").run(studentId('1'));
    c.send({ t: 'submit', id: 'u1', clientTs: Date.now() });
    await c.waitFor(() => c.messages.some((m) => m.t === 'submit.refused'));
    expect(c.messages.find((m) => m.t === 'submit.refused')).toMatchObject({
      id: 'u1',
      reason: 'not_working',
    });
  });
});

describe('time-up', () => {
  beforeEach(async () => {
    await setup(2);
    await start();
  });

  it('auto-submits after the grace with a save made before the deadline, and drops a later one', async () => {
    const c = await connect(await joinStudent('1'));
    passDeadline(200);
    const deadline = Date.now() - 200;
    c.send(save(1, { content: 'on time', clientTs: deadline - 50 }));
    c.send(save(2, { content: 'too late', clientTs: deadline + 50 }));
    await c.waitFor(() => acked(c, 1) && acked(c, 2));
    expect(versionCount('1')).toBe(1);
    // Inside the grace nothing is final yet.
    expect(studentRow('1').state).toBe('active');
    expect(examState()).toBe('running');

    await vi.waitFor(() => expect(studentRow('1').state).toBe('submitted'), { timeout: 6000 });
    expect(finals('1').find((r) => r.question_id === writtenId)?.content).toBe('on time');
    await vi.waitFor(() => expect(examState()).toBe('ended'), { timeout: 3000 });
    const pushed = c.messages.filter((m) => m.t === 'state' && m.state?.receipt);
    expect(pushed.length).toBeGreaterThan(0);
  });

  it('drops a save that arrives after the grace', async () => {
    const c = await connect(await joinStudent('1'));
    // Deadline long gone, but the 2 s grace has not been checked yet by the 1 s watcher tick.
    passDeadline(2500);
    c.send(save(1, { clientTs: Date.now() - HOUR - 3000 }));
    await c.waitFor(() => acked(c, 1));
    expect(versionCount('1')).toBe(0);
  });

  it('respects a personal extension and ends the exam only after the last one', async () => {
    const slow = await joinStudent('2');
    // A student who joins a running exam becomes active when the socket opens.
    await connect(await joinStudent('1'));
    db.prepare('UPDATE exam_students SET extension_sec = 3600 WHERE id = ?').run(studentId('2'));
    const c = await connect(slow);
    c.send(save(1, { content: 'still writing' }));
    await c.waitFor(() => acked(c, 1));
    passDeadline(3000);
    await vi.waitFor(() => expect(studentRow('1').state).toBe('submitted'), { timeout: 6000 });
    expect(studentRow('2').state).toBe('active');
    expect(examState()).toBe('running');
    expect(versionCount('2')).toBe(1);
  });
});

describe('the teacher ends the exam', () => {
  beforeEach(async () => {
    await setup(60);
    await start();
  });

  it('writes the final answers of everyone still working', async () => {
    const c = await connect(await joinStudent('1'));
    c.send(save(1, { content: 'half done' }));
    await c.waitFor(() => acked(c, 1));
    const ended = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/end`,
      headers: HEADERS,
    });
    expect(ended.statusCode).toBe(200);
    const row = studentRow('1');
    expect(row.state).toBe('ended_by_teacher');
    expect(row.submission_hash).not.toBeNull();
    expect(finals('1').find((r) => r.question_id === writtenId)?.content).toBe('half done');
  });
});

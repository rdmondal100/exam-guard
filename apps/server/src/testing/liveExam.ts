import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import WebSocket from 'ws';
import { buildTeacherApp, type TeacherApp } from '../app.js';
import { initDatabase, type Db } from '../db/connectDb.js';
import { withInject, type Injectable } from './inject.js';

export const TEST_TOKEN = 't'.repeat(40);
const HEADERS = { 'x-teacher-token': TEST_TOKEN };
const PROTOCOL = { major: 1, minor: 0 };
const PIN = '004217';

/** A socket that records what it gets: JSON frames parsed, binary frames as bytes. */
export interface Peer {
  ws: WebSocket;
  json: { t: string; [k: string]: unknown }[];
  binary: Uint8Array[];
  closed: Promise<number>;
  waitFor(match: () => boolean, ms?: number): Promise<void>;
  last(t: string): { t: string; [k: string]: unknown } | undefined;
}

export interface LiveExam {
  app: Injectable<TeacherApp>;
  db: Db;
  examId: string;
  /** Teacher API call with the token. */
  call(
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
  ): ReturnType<Injectable<TeacherApp>['inject']>;
  /** Joins, accepts the notice, opens the socket and waits for `welcome`. */
  student(code: string): Promise<{ peer: Peer; id: string; token: string }>;
  /** A student socket that has not said hello yet. */
  rawStudent(): Promise<Peer>;
  /** Opens a socket for an existing token and waits for `welcome`. */
  reconnect(token: string): Promise<Peer>;
  /** POST /join only (for re-joins); returns the status and body. */
  join(
    code: string,
    deviceId: string,
  ): Promise<{ status: number; body: { token?: string; error?: { code: string } } }>;
  teacher(): Promise<Peer>;
  start(): Promise<void>;
  close(): Promise<void>;
}

/**
 * A hosted exam (two students on the list, one written question) on real loopback listeners, for
 * socket tests that need both the student and the teacher side.
 */
export async function startLiveExam(
  students = '1,Ada\n2,Bob\n',
  /** `PATCH /settings` before hosting starts (M43). */
  settings?: object,
): Promise<LiveExam> {
  const dir = mkdtempSync(joinPath(tmpdir(), 'eg-live-'));
  const db = initDatabase(dir);
  const sockets: WebSocket[] = [];
  const app = withInject(
    buildTeacherApp({
      token: TEST_TOKEN,
      db,
      hosting: {
        dataDir: dir,
        host: '127.0.0.1',
        port: 0,
        makePin: () => PIN,
        addresses: () => ['127.0.0.1'],
        advertise: () => () => {},
      },
    }),
  );
  await app.listen({ host: '127.0.0.1', port: 0 });
  const teacherPort = (app.server.address() as { port: number }).port;
  const call: LiveExam['call'] = (method, url, payload) =>
    app.inject({ method, url: `/api/v1${url}`, headers: HEADERS, ...(payload ? { payload } : {}) });

  await call('POST', '/auth/setup', { password: 'correct horse battery' });
  const list = (
    await call('POST', '/class-lists/import', { name: 'CSE', csvText: students })
  ).json().list;
  const examId = (
    await call('POST', '/exams', { title: 'Mid', durationMin: 60, classListId: list.id })
  ).json().id as string;
  await call('POST', `/exams/${examId}/questions`, {
    type: 'written',
    body: 'Explain a stack',
    allowedLanguages: [],
    studentNote: '',
    sampleAnswer: 'LIFO',
    sampleLanguage: 'text',
    aiNotes: '',
    criteria: [{ name: 'Accuracy', maxMarks: 2 }],
  });
  await call('POST', `/exams/${examId}/ready`);
  if (settings) {
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: HEADERS,
      payload: settings,
    });
  }
  const studentPort = (await call('POST', `/exams/${examId}/host`)).json().port as number;

  const post = (path: string, body: object, token?: string) =>
    new Promise<{ status: number; body: { token?: string; error?: { code: string } } }>(
      (resolve, reject) => {
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
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) }));
          },
        );
        req.on('error', reject);
        req.end(payload);
      },
    );

  const open = (url: string) =>
    new Promise<Peer>((resolve, reject) => {
      const ws = new WebSocket(url, { rejectUnauthorized: false });
      sockets.push(ws);
      const json: Peer['json'] = [];
      const binary: Uint8Array[] = [];
      const peer: Peer = {
        ws,
        json,
        binary,
        closed: new Promise((r) => ws.on('close', (code) => r(code))),
        waitFor: (match, ms = 2000) =>
          new Promise((res, rej) => {
            const started = Date.now();
            const tick = () => {
              if (match()) return res();
              if (Date.now() - started > ms) return rej(new Error('timed out'));
              setTimeout(tick, 10);
            };
            tick();
          }),
        last: (t) => [...json].reverse().find((m) => m.t === t),
      };
      ws.on('message', (data: Buffer, isBinary) => {
        if (isBinary) binary.push(new Uint8Array(data));
        else json.push(JSON.parse(data.toString()) as Peer['json'][number]);
      });
      ws.on('error', reject);
      ws.on('open', () => resolve(peer));
    });

  const join: LiveExam['join'] = (code, deviceId) =>
    post('/join', {
      studentCode: code,
      pin: PIN,
      deviceId,
      protocol: PROTOCOL,
      agent: { ok: true, helper: true, captureOk: true, monitors: 1 },
    });

  const reconnect = async (token: string) => {
    const peer = await open(`wss://127.0.0.1:${studentPort}/ws`);
    peer.ws.send(
      JSON.stringify({ t: 'hello', token, protocol: PROTOCOL, resume: { lastServerSeq: 0 } }),
    );
    await peer.waitFor(() => peer.json.some((m) => m.t === 'welcome'));
    return peer;
  };

  return {
    app,
    db,
    examId,
    call,
    join,
    reconnect,
    rawStudent: () => open(`wss://127.0.0.1:${studentPort}/ws`),
    student: async (code) => {
      const token = (await join(code, `device-${code}-aaaa`)).body.token ?? '';
      await post('/join/confirm', { noticeAccepted: true }, token);
      const peer = await reconnect(token);
      const roster = (await call('GET', `/exams/${examId}/roster`)).json() as {
        students: { id: string; studentCode: string }[];
      };
      const id = roster.students.find((s) => s.studentCode === code)?.id ?? '';
      return { peer, id, token };
    },
    teacher: async () => {
      const peer = await open(`ws://127.0.0.1:${teacherPort}/ws?token=${TEST_TOKEN}`);
      peer.ws.send(JSON.stringify({ t: 'subscribe', examId }));
      await peer.waitFor(() => peer.json.some((m) => m.t === 'hosting'));
      return peer;
    },
    start: async () => {
      await call('POST', `/exams/${examId}/start`);
    },
    close: async () => {
      for (const s of sockets.splice(0)) s.terminate();
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

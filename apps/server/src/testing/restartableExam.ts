import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import WebSocket from 'ws';
import { DEFAULT_MONITORING } from '@examguard/shared';
import { buildTeacherApp, type TeacherApp } from '../app.js';
import { initDatabase, type Db } from '../db/connectDb.js';
import { withInject, type Injectable } from './inject.js';

const TOKEN = 'r'.repeat(40);
const HEADERS = { 'x-teacher-token': TOKEN };
const PROTOCOL = { major: 1, minor: 0 };
const PASSWORD = 'correct horse battery';
export const RESTART_PIN = '004217';

export interface Msg {
  t: string;
  id?: string;
  clientSeq?: number;
  receipt?: { hash: string };
  state?: {
    examState?: string;
    studentState?: string;
    deadline?: number | null;
    saved?: { clientSeq: number }[];
    receipt?: { hash: string } | null;
  };
}

export interface StudentClient {
  ws: WebSocket;
  messages: Msg[];
  send(message: object): void;
  sendBinary(frame: Uint8Array): void;
  waitFor(match: () => boolean, ms?: number): Promise<void>;
}

/**
 * A hosted exam whose server can be stopped and started again on the same data folder, the way
 * `server.ts` starts it (listen, then `hosting.resume()`), for the crash-recovery tests (M48).
 * Each start opens the student listener on a new port; `connect` always uses the current one.
 */
export class RestartableExam {
  readonly dir = mkdtempSync(joinPath(tmpdir(), 'eg-recover-'));
  db!: Db;
  app!: Injectable<TeacherApp>;
  examId = '';
  writtenId = '';
  private sockets: WebSocket[] = [];

  /** Builds the exam (one written question, students 1 and 2) and hosts it. */
  async setup(graceSec = 60): Promise<void> {
    await this.boot();
    await this.call('POST', '/auth/setup', { password: PASSWORD });
    const list = (
      await this.call('POST', '/class-lists/import', { name: 'CSE', csvText: '1,Ada\n2,Bob\n' })
    ).json().list;
    this.examId = (
      await this.call('POST', '/exams', {
        title: 'Mid',
        durationMin: 60,
        classListId: list.id,
        monitoring: { ...DEFAULT_MONITORING, graceSec },
      })
    ).json().id;
    this.writtenId = (
      await this.call('POST', `/exams/${this.examId}/questions`, {
        type: 'written',
        body: 'Explain a stack',
        allowedLanguages: [],
        studentNote: '',
        sampleAnswer: 'LIFO',
        sampleLanguage: 'text',
        aiNotes: '',
        criteria: [{ name: 'Accuracy', maxMarks: 2 }],
      })
    ).json().id;
    await this.call('POST', `/exams/${this.examId}/ready`);
    await this.call('POST', `/exams/${this.examId}/host`);
  }

  /** The server process dies: sockets drop, listeners and the database close. */
  async stop(): Promise<void> {
    for (const s of this.sockets.splice(0)) s.terminate();
    await this.app.close();
    this.db.close();
  }

  /** The server starts again (main restarts the utility process) and the teacher logs in. */
  async restart(): Promise<void> {
    await this.boot();
    await this.app.hosting?.resume();
    await this.call('POST', '/auth/login', { password: PASSWORD });
  }

  /** Changes the stored data while the server is down (for example, time passing). */
  whileDown(change: (db: Db) => void): void {
    const db = initDatabase(this.dir);
    change(db);
    db.close();
  }

  async dispose(): Promise<void> {
    await this.stop().catch(() => {});
    rmSync(this.dir, { recursive: true, force: true });
  }

  call(method: 'GET' | 'POST', url: string, payload?: object) {
    return this.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: HEADERS,
      ...(payload ? { payload } : {}),
    });
  }

  get studentPort(): number {
    return this.app.hosting?.info(this.examId)?.port ?? 0;
  }

  async join(code: string, deviceId = `device-${code}-aaaa`): Promise<string> {
    const joined = await this.post('/join', {
      studentCode: code,
      pin: RESTART_PIN,
      deviceId,
      protocol: PROTOCOL,
      agent: { ok: true, helper: true, captureOk: true, monitors: 1 },
    });
    const token = String(joined.token ?? '');
    await this.post('/join/confirm', { noticeAccepted: true }, token);
    return token;
  }

  /** Opens the student socket on the current listener, says hello and waits for the welcome. */
  connect(token: string): Promise<StudentClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://127.0.0.1:${this.studentPort}/ws`, {
        rejectUnauthorized: false,
      });
      this.sockets.push(ws);
      const messages: Msg[] = [];
      const checks = new Set<() => void>();
      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()) as Msg);
        for (const check of [...checks]) check();
      });
      ws.on('error', reject);
      const client: StudentClient = {
        ws,
        messages,
        send: (message) => ws.send(JSON.stringify(message)),
        sendBinary: (frame) => ws.send(frame, { binary: true }),
        waitFor: (match, ms = 3000) =>
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

  private post(path: string, body: object, token?: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = request(
        {
          host: '127.0.0.1',
          port: this.studentPort,
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
          res.on('end', () => resolve(JSON.parse(text) as Record<string, unknown>));
        },
      );
      req.on('error', reject);
      req.end(payload);
    });
  }

  private async boot(): Promise<void> {
    this.db = initDatabase(this.dir);
    this.app = withInject(
      buildTeacherApp({
        token: TOKEN,
        db: this.db,
        hosting: {
          dataDir: this.dir,
          host: '127.0.0.1',
          port: 0,
          makePin: () => RESTART_PIN,
          addresses: () => ['127.0.0.1'],
          advertise: () => () => {},
        },
      }),
    );
    await this.app.listen({ host: '127.0.0.1', port: 0 });
  }
}

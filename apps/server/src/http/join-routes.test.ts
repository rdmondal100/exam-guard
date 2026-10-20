import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClassListRepo } from '../db/class-list-repo.js';
import type { Db } from '../db/connection.js';
import { initDatabase } from '../db/database.js';
import { EventRepo } from '../db/event-repo.js';
import { ExamRepo } from '../db/exam-repo.js';
import { ExamStudentRepo } from '../db/exam-student-repo.js';
import { JoinService } from '../join/join-service.js';
import { loadOrCreateCert } from '../tls/cert.js';
import { buildStudentApp } from './student-app.js';

let dir: string;
let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'eg-joinroutes-'));
  db = initDatabase(dir);
  const cert = await loadOrCreateCert(dir);
  const list = new ClassListRepo(db).create('CSE', [{ studentCode: '1', name: 'Ada' }], 1);
  const exams = new ExamRepo(db);
  const exam = exams.create({ title: 'Midterm', durationMin: 60, classListId: list.id }, 1);
  const joinService = new JoinService({
    exams,
    students: new ExamStudentRepo(db),
    events: new EventRepo(db),
    target: () => ({ examId: exam.id, pin: '123456', fingerprint: cert.fingerprint }),
  });
  app = buildStudentApp({
    cert,
    join: joinService,
    current: () => ({ examTitle: 'Midterm', state: 'hosting' }),
  });
});
afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const body = (over: object = {}) => ({
  studentCode: '1',
  pin: '123456',
  deviceId: 'device-aaaaaaaa',
  protocol: { major: 1, minor: 0 },
  agent: { ok: true, helper: true, captureOk: true, monitors: 1 },
  ...over,
});
const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: `/api/v1${url}`, payload: payload as object, headers });

describe('POST /join', () => {
  it('returns a token and the student name', async () => {
    const res = await post('/join', body());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Ada', examTitle: 'Midterm', state: 'not_joined' });
    expect(res.json().token).toEqual(expect.any(String));
  });

  it.each([
    [{ pin: '000000' }, 401, 'bad_pin'],
    [{ studentCode: '9' }, 403, 'not_on_list'],
    [{ protocol: { major: 9, minor: 0 } }, 426, 'protocol_mismatch'],
    [{ pin: 'abc' }, 400, 'invalid_body'],
  ])('refuses %j', async (over, status, code) => {
    const res = await post('/join', body(over));
    expect(res.statusCode).toBe(status);
    expect(res.json().error.code).toBe(code);
  });

  it('answers 409 for another device and 429 after repeated failures', async () => {
    await post('/join', body());
    const other = await post('/join', body({ deviceId: 'device-bbbbbbbb' }));
    expect([other.statusCode, other.json().error.code]).toEqual([409, 'already_active_elsewhere']);

    for (let i = 0; i < 5; i++) await post('/join', body({ pin: '000000' }));
    const limited = await post('/join', body());
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.details.retryAfterSec).toBeGreaterThan(0);
  });
});

describe('POST /join/confirm', () => {
  it('needs a bearer token', async () => {
    expect((await post('/join/confirm', { noticeAccepted: true })).statusCode).toBe(401);
    const bad = await post(
      '/join/confirm',
      { noticeAccepted: true },
      { authorization: 'Bearer x' },
    );
    expect(bad.statusCode).toBe(401);
  });

  it('requires the notice to be accepted', async () => {
    const { token } = (await post('/join', body())).json();
    const res = await post(
      '/join/confirm',
      { noticeAccepted: false },
      { authorization: `Bearer ${token}` },
    );
    expect(res.statusCode).toBe(400);
  });

  it('moves the student to the lobby', async () => {
    const { token } = (await post('/join', body())).json();
    const res = await post(
      '/join/confirm',
      { noticeAccepted: true },
      { authorization: `Bearer ${token}` },
    );
    expect(res.json()).toEqual({ ok: true, state: 'lobby' });
  });
});

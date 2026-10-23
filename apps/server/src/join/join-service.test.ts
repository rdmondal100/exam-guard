import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JoinRequest } from '@examguard/shared';
import { ClassListRepo } from '../db/class-list-repo.js';
import type { Db } from '../db/connection.js';
import { initDatabase } from '../db/database.js';
import { EventRepo } from '../db/event-repo.js';
import { ExamRepo } from '../db/exam-repo.js';
import { ExamStudentRepo } from '../db/exam-student-repo.js';
import { JoinError, JoinService, hashToken } from './join-service.js';

const PIN = '004217';
const FP = 'F'.repeat(43);
const request = (over: Partial<JoinRequest> = {}): JoinRequest => ({
  studentCode: '1',
  pin: PIN,
  deviceId: 'device-aaaaaaaa',
  protocol: { major: 1, minor: 0 },
  agent: { ok: true, helper: true, captureOk: true, monitors: 1 },
  ...over,
});

let dir: string;
let db: Db;
let examId: string;
let hosted: boolean;
let clock: number;
let tokens: number;
let service: JoinService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-join-'));
  db = initDatabase(dir);
  clock = 1000;
  tokens = 0;
  hosted = true;
  const list = new ClassListRepo(db).create(
    'CSE',
    [
      { studentCode: '1', name: 'Ada' },
      { studentCode: '2', name: 'Alan' },
    ],
    1,
  );
  const exams = new ExamRepo(db);
  examId = exams.create({ title: 'Midterm', durationMin: 60, classListId: list.id }, 1).id;
  service = new JoinService({
    exams,
    students: new ExamStudentRepo(db),
    events: new EventRepo(db),
    now: () => clock++,
    makeToken: () => `token-number-${++tokens}-padding`,
    target: () => (hosted ? { examId, pin: PIN, fingerprint: FP } : null),
  });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const refusal = (fn: () => unknown): JoinError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof JoinError) return e;
    throw e;
  }
  throw new Error('expected a JoinError');
};

describe('JoinService.join', () => {
  it('joins a student on the list and stores only the token hash', () => {
    const result = service.join(request(), '10.0.0.1');
    expect(result).toMatchObject({ name: 'Ada', examTitle: 'Midterm', state: 'not_joined' });
    const row = db.prepare('SELECT * FROM exam_students').get() as Record<string, unknown>;
    expect(row.token_hash).toBe(hashToken(result.token));
    expect(row.token_hash).not.toBe(result.token);
    expect(row).toMatchObject({ device_id: 'device-aaaaaaaa', pinned_fp: FP });
    expect(String(row.anon_id)).toHaveLength(16);
  });

  it('rejects a wrong PIN', () => {
    const e = refusal(() => service.join(request({ pin: '999999' }), '10.0.0.1'));
    expect([e.status, e.code]).toEqual([401, 'bad_pin']);
  });

  it('rejects an ID that is not on the list', () => {
    const e = refusal(() => service.join(request({ studentCode: '77' }), '10.0.0.1'));
    expect([e.status, e.code]).toEqual([403, 'not_on_list']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM exam_students').get()).toEqual({ n: 0 });
  });

  it.each([
    ['the agent is not ok', { ok: false, helper: true, captureOk: true, monitors: 1 }],
    ['the helper is missing', { ok: true, helper: false, captureOk: true, monitors: 1 }],
    ['the screen capture is black', { ok: true, helper: true, captureOk: false, monitors: 1 }],
    ['no monitor is seen', { ok: true, helper: true, captureOk: true, monitors: 0 }],
  ])('refuses to join when %s, without creating a row or counting a failed try', (_name, agent) => {
    for (let i = 0; i < 8; i++) {
      const e = refusal(() => service.join(request({ agent }), '10.0.0.1'));
      expect([e.status, e.code]).toEqual([403, 'agent_required']);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM exam_students').get()).toEqual({ n: 0 });
    // The limiter was not touched: a healthy agent joins at once from the same address.
    expect(service.join(request(), '10.0.0.1').name).toBe('Ada');
  });

  it('rejects another protocol major and a host that is not hosting', () => {
    const mismatch = refusal(() =>
      service.join(request({ protocol: { major: 2, minor: 0 } }), '10.0.0.1'),
    );
    expect([mismatch.status, mismatch.code]).toEqual([426, 'protocol_mismatch']);
    hosted = false;
    expect(refusal(() => service.join(request(), '10.0.0.1')).code).toBe('not_hosting');
  });

  it('resumes from the same device with a fresh token and keeps the state', () => {
    const first = service.join(request(), '10.0.0.1');
    service.confirm(first.token);
    const again = service.join(request(), '10.0.0.1');
    expect(again.examStudentId).toBe(first.examStudentId);
    expect(again.token).not.toBe(first.token);
    expect(again.state).toBe('lobby');
    expect(() => service.confirm(first.token)).toThrow(JoinError); // old token is dead
  });

  it('rejects the same ID from another device and logs a critical duplicate_login', () => {
    const first = service.join(request(), '10.0.0.1');
    const e = refusal(() => service.join(request({ deviceId: 'device-bbbbbbbb' }), '10.0.0.2'));
    expect([e.status, e.code]).toEqual([409, 'already_active_elsewhere']);
    const event = db.prepare('SELECT * FROM events').get() as Record<string, unknown>;
    expect(event).toMatchObject({
      exam_id: examId,
      exam_student_id: first.examStudentId,
      type: 'duplicate_login',
      severity: 'critical',
      source: 'server',
    });
    // The original session still works.
    expect(service.confirm(first.token)).toBe('lobby');
  });

  it('lets two different students join from two devices', () => {
    service.join(request(), '10.0.0.1');
    expect(
      service.join(request({ studentCode: '2', deviceId: 'device-bbbbbbbb' }), '10.0.0.2').name,
    ).toBe('Alan');
  });

  it('limits failed tries per IP but not other IPs', () => {
    for (let i = 0; i < 5; i++) {
      expect(refusal(() => service.join(request({ pin: '111111' }), '10.0.0.1')).code).toBe(
        'bad_pin',
      );
    }
    const limited = refusal(() => service.join(request(), '10.0.0.1'));
    expect([limited.status, limited.code]).toEqual([429, 'rate_limited']);
    expect(limited.details).toMatchObject({ retryAfterSec: expect.any(Number) });
    expect(service.join(request(), '10.0.0.9').name).toBe('Ada');
  });
});

describe('JoinService.confirm', () => {
  it('moves not_joined to lobby once and is idempotent', () => {
    const { token, examStudentId } = service.join(request(), '10.0.0.1');
    expect(service.confirm(token)).toBe('lobby');
    const joinedAt = db
      .prepare('SELECT joined_at FROM exam_students WHERE id = ?')
      .get(examStudentId);
    expect(service.confirm(token)).toBe('lobby');
    expect(
      db.prepare('SELECT joined_at FROM exam_students WHERE id = ?').get(examStudentId),
    ).toEqual(joinedAt);
  });

  it('rejects an unknown token', () => {
    expect(refusal(() => service.confirm('nope')).status).toBe(401);
  });
});

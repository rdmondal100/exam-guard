import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CertInfoSchema,
  DEFAULT_SETTINGS,
  TeacherSettingsSchema,
  type RunLimits,
} from '@examguard/shared';
import { buildTeacherApp, type TeacherApp } from '../app.js';
import { initDatabase, type Db } from '../db/connectDb.js';
import { EventRepo } from '../db/repositories/event.repo.js';
import { ScreenshotStore } from '../services/screenshots/screenshot-store.js';
import { withInject, type Injectable } from '../testing/inject.js';
import { startLiveExam, type LiveExam } from '../testing/liveExam.js';

const TOKEN = 's'.repeat(40);
const HEADERS = { 'x-teacher-token': TOKEN };
const PASSWORD = 'correct horse battery';

let dir: string;
let db: Db;
let app: Injectable<TeacherApp>;

const open = () => withInject(buildTeacherApp({ token: TOKEN, db, dataDir: dir }));
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: HEADERS, ...(payload ? { payload } : {}) });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'eg-settings-'));
  db = initDatabase(dir);
  app = open();
  await call('POST', '/auth/setup', { password: PASSWORD });
});
afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('settings (M43)', () => {
  it('starts with the defaults and keeps a change across a restart', async () => {
    expect((await call('GET', '/settings')).json()).toEqual(DEFAULT_SETTINGS);
    const runLimits: RunLimits = { timeMs: 30_000, memoryMb: 512, outputBytes: 8192, processes: 4 };
    const res = await call('PATCH', '/settings', {
      runLimits,
      ai: { provider: 'gemini', model: 'gemini-2.5-pro' },
      server: { studentPort: 48000 },
    });
    expect(res.statusCode).toBe(200);
    expect(TeacherSettingsSchema.parse(res.json())).toMatchObject({ runLimits });

    await app.close();
    app = open(); // a restarted server
    await call('POST', '/auth/login', { password: PASSWORD });
    expect((await call('GET', '/settings')).json()).toMatchObject({
      runLimits,
      ai: { model: 'gemini-2.5-pro' },
      server: { studentPort: 48000 },
      grading: DEFAULT_SETTINGS.grading,
    });
  });

  it('refuses invalid values and needs a login', async () => {
    const bad = await call('PATCH', '/settings', { grading: { concurrency: 0 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details.problems[0]).toMatch(/^grading\.concurrency/);
    expect(
      (await call('PATCH', '/settings', { ai: { provider: 'openai', model: 'x' } })).statusCode,
    ).toBe(400);
    await call('POST', '/auth/logout');
    expect((await call('GET', '/settings')).statusCode).toBe(401);
  });

  it('new exams get the default monitoring from Settings', async () => {
    const monitoring = { ...DEFAULT_SETTINGS.defaults.monitoring, highSeverityApps: ['code.exe'] };
    await call('PATCH', '/settings', { defaults: { durationMin: 90, monitoring } });
    const exam = (await call('POST', '/exams', { title: 'Lab', durationMin: 90 })).json();
    expect(exam.monitoring.highSeverityApps).toEqual(['code.exe']);
  });

  it('changes the password only with the right current one', async () => {
    const wrong = await call('POST', '/auth/change', {
      currentPassword: 'nope',
      newPassword: 'a new long password',
    });
    expect(wrong.statusCode).toBe(401);
    expect(
      (await call('POST', '/auth/change', { currentPassword: PASSWORD, newPassword: 'short' }))
        .statusCode,
    ).toBe(400);
    const ok = await call('POST', '/auth/change', {
      currentPassword: PASSWORD,
      newPassword: 'a new long password',
    });
    expect(ok.statusCode).toBe(200);
    await call('POST', '/auth/logout');
    expect((await call('POST', '/auth/login', { password: PASSWORD })).statusCode).toBe(401);
    expect(
      (await call('POST', '/auth/login', { password: 'a new long password' })).statusCode,
    ).toBe(200);
  });

  it('takes a manual backup', async () => {
    const res = await call('POST', '/settings/backup');
    expect(res.statusCode).toBe(200);
    expect(existsSync(join(dir, 'backups', res.json().backup, 'examguard.sqlite'))).toBe(true);
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
  });

  it('regenerates the certificate, but not while an exam is hosted', async () => {
    const before = CertInfoSchema.parse((await call('GET', '/settings/cert')).json());
    expect((await call('GET', '/settings/cert')).json()).toEqual(before);
    const after = CertInfoSchema.parse((await call('POST', '/settings/regenerate-cert')).json());
    expect(after.fingerprint).not.toBe(before.fingerprint);

    const exam = (await call('POST', '/exams', { title: 'Lab', durationMin: 60 })).json();
    db.prepare("UPDATE exams SET state = 'hosting' WHERE id = ?").run(exam.id);
    const refused = await call('POST', '/settings/regenerate-cert');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('hosting_active');
  });
});

describe('run limits reach students at the next exam (M43)', () => {
  let live: LiveExam | null = null;
  afterEach(async () => {
    await live?.close();
    live = null;
  });

  it('the welcome carries the limits fixed when hosting started', async () => {
    const limits: RunLimits = { timeMs: 20_000, memoryMb: 128, outputBytes: 16384, processes: 2 };
    live = await startLiveExam(undefined, { runLimits: limits });
    const { peer, token } = await live.student('1');
    expect(peer.last('welcome')?.state).toMatchObject({ runLimits: limits });

    // A change during the exam does not reach it.
    await live.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { 'x-teacher-token': 't'.repeat(40) },
      payload: { runLimits: { ...limits, memoryMb: 1024 } },
    });
    const again = await live.reconnect(token);
    expect(again.last('welcome')?.state).toMatchObject({ runLimits: limits });
  });
});

describe('screenshot retention (M44)', () => {
  const DAY = 24 * 60 * 60 * 1000;

  const seed = async () => {
    const exam = (await call('POST', '/exams', { title: 'Lab', durationMin: 60 })).json();
    db.exec(`
      INSERT INTO class_lists (id, name, created_at) VALUES ('l1', 'CSE', 1);
      INSERT INTO class_students (id, class_list_id, student_code, name) VALUES ('c1', 'l1', '1', 'Ada');
      INSERT INTO exam_students (id, exam_id, class_student_id, anon_id) VALUES ('s1', '${exam.id}', 'c1', 'a');
    `);
    const events = new EventRepo(db);
    const store = new ScreenshotStore(dir);
    const add = (serverTs: number) => {
      const id = events.insertReturningId({
        examId: exam.id,
        examStudentId: 's1',
        type: 'focus_lost',
        severity: 'medium',
        source: 'agent',
        details: {},
        serverTs,
      });
      if (id === null) throw new Error('not stored');
      const path = store.save(exam.id, 's1', id, Buffer.from([0xff, 0xd8]));
      events.setScreenshot(id, path);
      return { id, path };
    };
    return {
      examId: exam.id as string,
      events,
      old: add(Date.now() - 10 * DAY),
      fresh: add(Date.now()),
    };
  };

  it('keeps everything by default and deletes old pictures once days are set', async () => {
    const { events, old, fresh } = await seed();
    expect((await call('POST', '/settings/retention/purge')).json()).toEqual({ removed: 0 });

    await call('PATCH', '/settings', { retention: { screenshotDays: 7 } });
    expect((await call('POST', '/settings/retention/purge')).json()).toEqual({ removed: 1 });
    expect(existsSync(join(dir, old.path))).toBe(false);
    expect(events.screenshotOf(old.id)).toBeUndefined();
    expect(events.screenshotOf(fresh.id)?.path).toBe(fresh.path);
    expect(existsSync(join(dir, fresh.path))).toBe(true);
  });

  it('0 days clears an ended exam but never a live one', async () => {
    const { examId, events, fresh } = await seed();
    await call('PATCH', '/settings', { retention: { screenshotDays: 0 } });
    db.prepare("UPDATE exams SET state = 'running' WHERE id = ?").run(examId);
    expect((await call('POST', '/settings/retention/purge')).json()).toEqual({ removed: 0 });

    db.prepare("UPDATE exams SET state = 'ended' WHERE id = ?").run(examId);
    // A restarted server applies the setting on its own at start.
    await app.close();
    app = open();
    expect(app.retention?.purge()).toBe(2);
    expect(events.screenshotOf(fresh.id)).toBeUndefined();
  });

  it('refuses out-of-range days', async () => {
    const res = await call('PATCH', '/settings', { retention: { screenshotDays: -1 } });
    expect(res.statusCode).toBe(400);
  });
});

describe('data folder release check (M44)', () => {
  it('is free when idle, busy while hosting or grading', async () => {
    expect(app.maintenance.dataBusyReason()).toBeNull();
    const exam = (await call('POST', '/exams', { title: 'Lab', durationMin: 60 })).json();
    db.prepare("UPDATE exams SET state = 'hosting' WHERE id = ?").run(exam.id);
    expect(app.maintenance.dataBusyReason()).toMatch(/Stop hosting/);
    db.prepare("UPDATE exams SET state = 'ended' WHERE id = ?").run(exam.id);
    expect(app.maintenance.dataBusyReason()).toBeNull();

    db.prepare(
      `INSERT INTO questions (id, exam_id, position, type, body, marks, sample_language)
         VALUES ('q', ?, 0, 'written', 'Why?', 2, 'text')`,
    ).run(exam.id);
    db.prepare(
      `INSERT INTO grading_jobs (id, exam_id, question_id, kind, position, provider, model,
         prompt_version, created_at) VALUES ('j1', ?, 'q', 'initial', 0, 'fake', 'm', 'v1', 1)`,
    ).run(exam.id);
    expect(app.maintenance.dataBusyReason()).toMatch(/grading/);
  });
});

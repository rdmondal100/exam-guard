import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './connectDb.js';
import { databasePath, initDatabase } from './connectDb.js';
import { migrate } from './migrate.js';
import { loadMigrations } from './migrations.js';
import { SettingsRepo } from './repositories/settings.repo.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-db-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('initDatabase', () => {
  it('creates a WAL database at the latest version with the tables so far', () => {
    const db = initDatabase(dir);
    expect(existsSync(databasePath(dir))).toBe(true);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('user_version', { simple: true })).toBe(18);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(
      [
        'answer_grades',
        'answer_versions',
        'class_lists',
        'class_students',
        'evaluations',
        'exam_files',
        'exam_students',
        'final_answers',
        'grading_jobs',
        'events',
        'exams',
        'marking_criteria',
        'questions',
        'settings',
        'teacher',
        'teacher_actions',
        'terminal_chunks',
      ].sort(),
    );
    db.close();
  });

  it('is a no-op the second time and keeps data', () => {
    const first = initDatabase(dir);
    new SettingsRepo(first).set('a', 1);
    first.close();
    const second = initDatabase(dir);
    expect(second.pragma('user_version', { simple: true })).toBe(18);
    expect(new SettingsRepo(second).get('a')).toBe(1);
    second.close();
  });

  it('rejects a database from a newer app', () => {
    const db = openDatabase(databasePath(dir));
    db.pragma('user_version = 99');
    db.close();
    expect(() => initDatabase(dir)).toThrow(/newer than this app/);
  });
});

describe('migrate', () => {
  it('rolls a failing migration back completely', () => {
    const db = openDatabase(join(dir, 'x.sqlite'));
    const bad = [
      { version: 1, name: '0001_a.sql', sql: 'CREATE TABLE a (id INTEGER);' },
      { version: 2, name: '0002_b.sql', sql: 'CREATE TABLE b (id INTEGER); NOT SQL;' },
    ];
    expect(() => migrate(db, bad)).toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    expect(tables).toEqual([{ name: 'a' }]);
    db.close();
  });
});

describe('0016: the monitor moved into the student app', () => {
  it('keeps old agent evidence as monitor evidence and drops the internet switch', () => {
    const all = loadMigrations(fileURLToPath(new URL('./migrations', import.meta.url)));
    const db = openDatabase(join(dir, 'old.sqlite'));
    migrate(
      db,
      all.filter((m) => m.version <= 15),
    );
    db.prepare(
      `INSERT INTO exams (id, title, duration_sec, monitoring_json, created_at, updated_at, internet_blocked)
         VALUES ('e1', 'Mid', 3600, '{}', 1, 1, 1)`,
    ).run();
    const event = db.prepare(
      `INSERT INTO events (exam_id, type, severity, server_ts, source, dedupe_key, screenshot_path)
         VALUES ('e1', ?, 'high', 5, ?, ?, ?)`,
    );
    event.run('focus_lost', 'agent', 'agent:s1:1', 'screenshots/e1/s1/1.jpg');
    event.run('run_executed', 'app', 'app:x', null);

    expect(migrate(db, all)).toBe(18);
    expect(
      db.prepare('SELECT id, type, source, dedupe_key, screenshot_path FROM events').all(),
    ).toEqual([
      {
        id: 1,
        type: 'focus_lost',
        source: 'monitor',
        dedupe_key: 'agent:s1:1',
        screenshot_path: 'screenshots/e1/s1/1.jpg',
      },
      { id: 2, type: 'run_executed', source: 'app', dedupe_key: 'app:x', screenshot_path: null },
    ]);
    const columns = db.prepare('PRAGMA table_info(exams)').all() as { name: string }[];
    expect(columns.map((c) => c.name)).not.toContain('internet_blocked');
    // New rows keep counting after the old ids, and 'agent' is no longer a valid source.
    event.run('focus_lost', 'monitor', 'monitor:s1:2', null);
    expect(db.prepare('SELECT MAX(id) AS id FROM events').get()).toEqual({ id: 3 });
    expect(() => event.run('focus_lost', 'agent', 'agent:s1:3', null)).toThrow(/CHECK/);
    db.close();
  });
});

describe('loadMigrations', () => {
  it('sorts by number and ignores other files', () => {
    writeFileSync(join(dir, '0002_b.sql'), 'SELECT 2;');
    writeFileSync(join(dir, '0001_a.sql'), 'SELECT 1;');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    expect(loadMigrations(dir).map((m) => m.version)).toEqual([1, 2]);
  });

  it('rejects a numbering gap', () => {
    writeFileSync(join(dir, '0001_a.sql'), 'SELECT 1;');
    writeFileSync(join(dir, '0003_c.sql'), 'SELECT 3;');
    expect(() => loadMigrations(dir)).toThrow(/numbering/);
  });
});

describe('schema constraints and SettingsRepo', () => {
  it('only allows teacher id 1', () => {
    const db = initDatabase(dir);
    const insert = db.prepare(
      'INSERT INTO teacher (id, password_hash, created_at, updated_at) VALUES (?, ?, 0, 0)',
    );
    expect(() => insert.run(2, 'h')).toThrow();
    insert.run(1, 'h');
    db.close();
  });

  it('upserts and reads JSON settings', () => {
    const db = initDatabase(dir);
    const repo = new SettingsRepo(db);
    expect(repo.get('k')).toBeUndefined();
    repo.set('k', { n: 1 });
    repo.set('k', { n: 2 });
    expect(repo.get('k')).toEqual({ n: 2 });
    db.close();
  });
});

describe('0017: practice exams', () => {
  it('marks every existing exam as a real (non-practice) exam', () => {
    const all = loadMigrations(fileURLToPath(new URL('./migrations', import.meta.url)));
    const db = openDatabase(join(dir, 'practice.sqlite'));
    migrate(
      db,
      all.filter((m) => m.version <= 16),
    );
    db.prepare(
      `INSERT INTO exams (id, title, duration_sec, monitoring_json, created_at, updated_at)
         VALUES ('e1', 'Mid', 3600, '{}', 1, 1)`,
    ).run();
    expect(migrate(db, all)).toBe(18);
    expect(db.prepare('SELECT practice FROM exams').get()).toEqual({ practice: 0 });
    expect(() => db.prepare("UPDATE exams SET practice = 2 WHERE id = 'e1'").run()).toThrow(
      /CHECK/,
    );
    db.close();
  });
});

describe('0018: pause', () => {
  it('starts every existing exam unpaused with no paused time', () => {
    const all = loadMigrations(fileURLToPath(new URL('./migrations', import.meta.url)));
    const db = openDatabase(join(dir, 'pause.sqlite'));
    migrate(
      db,
      all.filter((m) => m.version <= 17),
    );
    db.prepare(
      `INSERT INTO exams (id, title, duration_sec, monitoring_json, created_at, updated_at)
         VALUES ('e1', 'Mid', 3600, '{}', 1, 1)`,
    ).run();
    expect(migrate(db, all)).toBe(18);
    expect(db.prepare('SELECT paused_at, paused_ms FROM exams').get()).toEqual({
      paused_at: null,
      paused_ms: 0,
    });
    db.close();
  });
});

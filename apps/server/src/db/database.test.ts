import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './connection.js';
import { databasePath, initDatabase } from './database.js';
import { migrate } from './migrate.js';
import { loadMigrations } from './migrations.js';
import { SettingsRepo } from './settings-repo.js';

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
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual([
      'class_lists',
      'class_students',
      'settings',
      'teacher',
    ]);
    db.close();
  });

  it('is a no-op the second time and keeps data', () => {
    const first = initDatabase(dir);
    new SettingsRepo(first).set('a', 1);
    first.close();
    const second = initDatabase(dir);
    expect(second.pragma('user_version', { simple: true })).toBe(2);
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

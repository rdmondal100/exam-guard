import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from './migrate.js';
import { loadMigrations } from './migrations.js';

export type Db = Database.Database;

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

/** Opens the SQLite file (creating its folder) with the pragmas from data-model.md. */
export function openDatabase(dbPath: string): Db {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function databasePath(dataDir: string): string {
  return join(dataDir, 'db', 'examguard.sqlite');
}

/** Opens `<dataDir>/db/examguard.sqlite` and brings it up to the latest schema. */
export function initDatabase(dataDir: string): Db {
  const db = openDatabase(databasePath(dataDir));
  try {
    migrate(db, loadMigrations(MIGRATIONS_DIR));
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

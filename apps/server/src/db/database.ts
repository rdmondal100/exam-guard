import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, type Db } from './connection.js';
import { migrate } from './migrate.js';
import { loadMigrations } from './migrations.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

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

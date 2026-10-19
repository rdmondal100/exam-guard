import type { Db } from './connection.js';
import type { Migration } from './migrations.js';

/** Applies pending migrations, each in its own transaction, tracked by `PRAGMA user_version`. */
export function migrate(db: Db, migrations: Migration[]): number {
  const current = Number(db.pragma('user_version', { simple: true }));
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  if (current > latest) {
    throw new Error(`Database is at version ${current}, newer than this app (${latest})`);
  }
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
  return Number(db.pragma('user_version', { simple: true }));
}

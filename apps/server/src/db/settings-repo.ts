import type { Db } from './connection.js';

/** Key/value settings. Values are JSON; the caller validates them with a Zod schema. */
export class SettingsRepo {
  constructor(private readonly db: Db) {}

  get(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.value) as unknown);
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, JSON.stringify(value));
  }
}

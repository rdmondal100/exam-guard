import type { Db } from './connection.js';

/** The single teacher account (`teacher.id = 1`). */
export class TeacherRepo {
  constructor(private readonly db: Db) {}

  exists(): boolean {
    return this.db.prepare('SELECT 1 FROM teacher WHERE id = 1').get() !== undefined;
  }

  getPasswordHash(): string | undefined {
    const row = this.db.prepare('SELECT password_hash FROM teacher WHERE id = 1').get() as
      { password_hash: string } | undefined;
    return row?.password_hash;
  }

  /** Throws if the teacher already exists. */
  create(passwordHash: string, now: number): void {
    this.db
      .prepare(
        'INSERT INTO teacher (id, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?)',
      )
      .run(passwordHash, now, now);
  }
}

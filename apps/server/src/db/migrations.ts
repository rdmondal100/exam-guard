import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const FILE_PATTERN = /^(\d{4})_[\w-]+\.sql$/;

/** Reads `NNNN_name.sql` files from a folder. Numbers must run 1, 2, 3... with no gaps. */
export function loadMigrations(dir: string): Migration[] {
  const migrations: Migration[] = [];
  for (const file of readdirSync(dir)) {
    const match = FILE_PATTERN.exec(file);
    if (!match) continue;
    migrations.push({
      version: Number(match[1]),
      name: file,
      sql: readFileSync(join(dir, file), 'utf8'),
    });
  }
  migrations.sort((a, b) => a.version - b.version);

  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`Migration numbering broken at ${migration.name}: expected ${index + 1}`);
    }
  });
  return migrations;
}

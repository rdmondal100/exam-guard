import { existsSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '../../db/connectDb.js';

const stamp = (at: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-` +
    `${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`
  );
};

/**
 * `backups/<yyyyMMdd-HHmmss>/` (data-model): an online SQLite backup (safe while the server
 * writes) plus a copy of `screenshots/`. Taken before finalize (M42); Settings gets a manual one
 * later (M43). Returns the folder name.
 */
export async function backupData(db: Db, dataDir: string, at: Date): Promise<string> {
  const base = stamp(at);
  let name = base;
  for (let n = 2; existsSync(join(dataDir, 'backups', name)); n += 1) name = `${base}-${n}`;
  const dir = join(dataDir, 'backups', name);
  await mkdir(dir, { recursive: true });
  await db.backup(join(dir, 'examguard.sqlite'));
  const screenshots = join(dataDir, 'screenshots');
  if (existsSync(screenshots)) {
    await cp(screenshots, join(dir, 'screenshots'), { recursive: true });
  }
  return name;
}

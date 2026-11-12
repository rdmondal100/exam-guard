import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';

/** `<userData>/data-location.json`: where the teacher's data folder is, when it was moved (M44). */
export function locationFile(userData: string): string {
  return join(userData, 'data-location.json');
}

/** The data folder: the moved one when the pointer is valid, else the profile folder. */
export function loadDataDir(userData: string): string {
  try {
    const raw: unknown = JSON.parse(readFileSync(locationFile(userData), 'utf8'));
    const dir = (raw as { dataDir?: unknown }).dataDir;
    if (typeof dir === 'string' && isAbsolute(dir)) return normalize(dir);
  } catch {
    // No pointer (never moved) or a damaged one: the profile folder.
  }
  return userData;
}

/** Points the app at `dataDir`; the profile folder itself needs no pointer. */
export function saveDataDir(userData: string, dataDir: string): void {
  const file = locationFile(userData);
  if (samePath(dataDir, userData)) {
    rmSync(file, { force: true });
    return;
  }
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ dataDir: normalize(dataDir) }));
  renameSync(tmp, file);
}

/** Windows paths compare without regard to case or a trailing separator. */
export function samePath(a: string, b: string): boolean {
  const clean = (p: string) =>
    normalize(p)
      .replace(/[\\/]+$/, '')
      .toLowerCase();
  return clean(a) === clean(b);
}

/** Whether `child` lies inside `parent` (not equal to it). */
export function isInside(child: string, parent: string): boolean {
  const c = normalize(child).toLowerCase();
  const p = normalize(parent)
    .replace(/[\\/]+$/, '')
    .toLowerCase();
  return c.length > p.length && c.startsWith(p) && /[\\/]/.test(c.charAt(p.length));
}

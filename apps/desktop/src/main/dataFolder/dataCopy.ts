import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { cp, lstat, readdir, rm, statfs } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

/**
 * What the data folder holds (docs/data-model.md). Only these move: the profile folder also holds
 * Electron's own files and `mode.json`, which stay where they are.
 */
export const DATA_ENTRIES = [
  'db',
  'secrets.bin',
  'certs',
  'screenshots',
  'exam-files',
  'exports',
  'backups',
  'logs',
] as const;

/** Room kept free on the target drive on top of the data itself. */
const SPARE_BYTES = 64 * 1024 * 1024;

/**
 * The folder the data goes to: the picked one when it is missing or empty, else an `ExamGuard`
 * folder inside it, so picking `D:\` does not spread files over the drive root.
 */
export async function targetFor(picked: string): Promise<string> {
  if (!existsSync(picked)) return picked;
  const items = await readdir(picked);
  return items.length === 0 ? picked : join(picked, 'ExamGuard');
}

/** Data entries that already exist in `dir` (a move never overwrites them). */
export function existingEntries(dir: string): string[] {
  return DATA_ENTRIES.filter((name) => existsSync(join(dir, name)));
}

/** Every file under the data entries of `root`, as paths relative to it, with their sizes. */
export async function listFiles(root: string): Promise<Map<string, number>> {
  const files = new Map<string, number>();
  const walk = async (path: string): Promise<void> => {
    const info = await lstat(path);
    if (info.isDirectory()) {
      for (const name of await readdir(path)) await walk(join(path, name));
    } else if (info.isFile()) {
      files.set(relative(root, path), info.size);
    }
  };
  for (const name of existingEntries(root)) await walk(join(root, name));
  return files;
}

/** Free bytes on the drive that would hold `dir` (its nearest existing parent). */
async function freeBytes(dir: string): Promise<number> {
  let probe = dir;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const fs = await statfs(probe);
  return fs.bavail * fs.bsize;
}

/** `null` when the target drive has room for `bytes`, else a message for the teacher. */
export async function checkSpace(dir: string, bytes: number): Promise<string | null> {
  const free = await freeBytes(dir);
  if (free >= bytes + SPARE_BYTES) return null;
  const mb = (n: number) => Math.ceil(n / (1024 * 1024));
  return `Not enough free space there: the data needs ${mb(bytes)} MB, the drive has ${mb(free)} MB free.`;
}

/** Copies every data entry of `from` into `to` (which must not have them yet). */
export async function copyData(from: string, to: string): Promise<void> {
  for (const name of existingEntries(from)) {
    await cp(join(from, name), join(to, name), {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    });
  }
}

const hashOf = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });

/**
 * `null` when `to` holds the same files as `from` (same names, sizes and SHA-256), else what is
 * wrong. Run with the server stopped, so nothing changes in between.
 */
export async function verifyCopy(from: string, to: string): Promise<string | null> {
  const source = await listFiles(from);
  const copy = await listFiles(to);
  if (copy.size !== source.size) {
    return `The copy has ${copy.size} files, the data folder ${source.size}.`;
  }
  for (const [path, size] of source) {
    if (copy.get(path) !== size) return `${path} was not copied completely.`;
    if ((await hashOf(join(from, path))) !== (await hashOf(join(to, path)))) {
      return `${path} differs from the original.`;
    }
  }
  return null;
}

/** Deletes the data entries of `dir`. Returns the entries that could not be deleted. */
export async function removeData(dir: string): Promise<string[]> {
  const failed: string[] = [];
  for (const name of existingEntries(dir)) {
    try {
      await rm(join(dir, name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      failed.push(name);
    }
  }
  return failed;
}

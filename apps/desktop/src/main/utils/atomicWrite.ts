import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';

/**
 * Replaces `path` with `data` so that a crash or a power cut at any moment leaves either the old
 * file or the new one, never an empty or half-written one (M61): write a temp file next to it,
 * flush it to the disk, then rename it over the original.
 */
export function writeFileAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** Flushes what was appended to `path` to the disk (the OS may otherwise hold it for a while). */
export function fsyncFile(path: string): void {
  const fd = openSync(path, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

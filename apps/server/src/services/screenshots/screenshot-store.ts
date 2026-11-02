import { createReadStream, type ReadStream } from 'node:fs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** Ids come from `newId` (hex and dashes). Anything else never becomes part of a path. */
const SAFE_ID = /^[A-Za-z0-9-]+$/;

function safe(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`Unsafe id for a file path: ${id}`);
  return id;
}

const FOLDER = 'screenshots';

/**
 * The screenshots the agents took: `<data>/screenshots/<examId>/<examStudentId>/<eventId>.jpg`.
 * `events.screenshot_path` holds the path relative to the data folder.
 */
export class ScreenshotStore {
  constructor(private readonly dataDir: string) {}

  /** Writes the picture and returns its path relative to the data folder. */
  save(examId: string, examStudentId: string, eventId: number, jpeg: Uint8Array): string {
    const folder = join(FOLDER, safe(examId), safe(examStudentId));
    mkdirSync(join(this.dataDir, folder), { recursive: true });
    const path = join(folder, `${Math.trunc(eventId)}.jpg`);
    writeFileSync(join(this.dataDir, path), jpeg);
    return path;
  }

  /** A stream of a stored picture, or `null` when the path points outside the screenshots folder. */
  open(path: string): ReadStream | null {
    const root = resolve(this.dataDir, FOLDER);
    const full = resolve(this.dataDir, path);
    const inside = relative(root, full);
    if (inside === '' || inside.startsWith('..') || inside.split(sep).includes('..')) return null;
    return createReadStream(full);
  }

  /** Everything of one exam (when the exam is deleted). */
  removeExam(examId: string): void {
    rmSync(join(this.dataDir, FOLDER, safe(examId)), { recursive: true, force: true });
  }
}

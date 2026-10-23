import { createReadStream, type ReadStream } from 'node:fs';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Ids come from `newId` (hex and dashes). Anything else never becomes part of a path. */
const SAFE_ID = /^[A-Za-z0-9-]+$/;

function safe(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`Unsafe id for a file path: ${id}`);
  return id;
}

/**
 * The bytes of the files the teacher attached: `<root>/<examId>/<fileId>`, one file each, so 200
 * students can stream them from disk. The manifest is in `exam_files` (`ExamFileRepo`).
 */
export class ExamFileStore {
  constructor(private readonly root: string) {}

  private path(examId: string, fileId: string): string {
    return join(this.root, safe(examId), safe(fileId));
  }

  async save(examId: string, fileId: string, data: Buffer): Promise<void> {
    await mkdir(join(this.root, safe(examId)), { recursive: true });
    await writeFile(this.path(examId, fileId), data);
  }

  /** The size on disk, or `null` if the file is missing. */
  async size(examId: string, fileId: string): Promise<number | null> {
    const info = await stat(this.path(examId, fileId)).catch(() => null);
    return info?.isFile() ? info.size : null;
  }

  open(examId: string, fileId: string): ReadStream {
    return createReadStream(this.path(examId, fileId));
  }

  async copy(fromExam: string, fromFile: string, toExam: string, toFile: string): Promise<void> {
    await mkdir(join(this.root, safe(toExam)), { recursive: true });
    await copyFile(this.path(fromExam, fromFile), this.path(toExam, toFile));
  }

  async remove(examId: string, fileId: string): Promise<void> {
    await rm(this.path(examId, fileId), { force: true });
  }

  /** The exam's whole folder (when the exam is deleted). */
  async removeExam(examId: string): Promise<void> {
    await rm(join(this.root, safe(examId)), { recursive: true, force: true });
  }
}

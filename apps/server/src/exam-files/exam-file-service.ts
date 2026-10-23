import { createHash } from 'node:crypto';
import type { ReadStream } from 'node:fs';
import { EXAM_FILE_LIMITS, checkFileName, type ExamFile } from '@examguard/shared';
import type { ExamFileRepo } from '../db/exam-file-repo.js';
import { newId } from '../db/ids.js';
import type { ExamFileStore } from './exam-file-store.js';

/** A refusal with the HTTP status and error code the route sends. */
export class ExamFileError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExamFileError';
  }
}

const MB = 1024 * 1024;

/**
 * The teacher's exam files: the rules (name, sizes, count, replace by name) over the manifest
 * (`ExamFileRepo`) and the bytes on disk (`ExamFileStore`). Whether the exam may still be edited
 * is the route's check.
 */
export class ExamFileService {
  constructor(
    private readonly repo: ExamFileRepo,
    private readonly store: ExamFileStore,
  ) {}

  list(examId: string): ExamFile[] {
    return this.repo.list(examId);
  }

  get(examId: string, fileId: string): ExamFile | undefined {
    return this.repo.get(examId, fileId);
  }

  /** Adds a file, or replaces the one with the same name (any letter case). */
  async add(examId: string, name: string, data: Buffer, now: number): Promise<ExamFile> {
    const problem = checkFileName(name);
    if (problem) throw new ExamFileError(400, 'invalid_name', problem);
    if (data.length > EXAM_FILE_LIMITS.fileBytes) {
      throw new ExamFileError(
        413,
        'file_too_large',
        `A file can be at most ${EXAM_FILE_LIMITS.fileBytes / MB} MB`,
      );
    }
    const existing = this.repo.findByName(examId, name);
    const totals = this.repo.totals(examId);
    const bytes = totals.bytes - (existing?.size ?? 0) + data.length;
    if (bytes > EXAM_FILE_LIMITS.totalBytes) {
      throw new ExamFileError(
        413,
        'exam_files_full',
        `An exam can have at most ${EXAM_FILE_LIMITS.totalBytes / MB} MB of files`,
      );
    }
    if (!existing && totals.count >= EXAM_FILE_LIMITS.count) {
      throw new ExamFileError(
        413,
        'exam_files_full',
        `An exam can have at most ${EXAM_FILE_LIMITS.count} files`,
      );
    }
    const file: ExamFile = {
      id: newId(now),
      name,
      size: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    };
    await this.store.save(examId, file.id, data);
    try {
      if (existing) this.repo.replace(examId, existing.id, file, now);
      else this.repo.insert(examId, file, now);
    } catch (e) {
      await this.store.remove(examId, file.id);
      throw e;
    }
    if (existing) await this.store.remove(examId, existing.id);
    return file;
  }

  async remove(examId: string, fileId: string): Promise<boolean> {
    if (!this.repo.delete(examId, fileId)) return false;
    await this.store.remove(examId, fileId);
    return true;
  }

  /** Gives a duplicated exam its own copy of every file (new ids, same bytes). */
  async copyExam(fromExam: string, toExam: string, now: number): Promise<void> {
    for (const file of this.repo.list(fromExam)) {
      const copy: ExamFile = { ...file, id: newId(now) };
      await this.store.copy(fromExam, file.id, toExam, copy.id);
      this.repo.insert(toExam, copy, now);
    }
  }

  /** The bytes of a file when the exam is deleted (the rows go with the exam). */
  async removeExam(examId: string): Promise<void> {
    await this.store.removeExam(examId);
  }

  /** The stream for a download, or `null` if the file is gone from disk. */
  async open(examId: string, file: ExamFile): Promise<ReadStream | null> {
    return (await this.store.size(examId, file.id)) === null
      ? null
      : this.store.open(examId, file.id);
  }
}

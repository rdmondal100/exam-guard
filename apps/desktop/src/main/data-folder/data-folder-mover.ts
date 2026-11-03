import { mkdir } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { DataFolderMoveResult } from '@examguard/shared';
import {
  checkSpace,
  copyData,
  existingEntries,
  listFiles,
  removeData,
  targetFor,
  verifyCopy,
} from './data-copy.js';
import type { DataFolder } from './data-folder.js';
import { isInside, samePath } from './data-location.js';

/** The part of `ServerHost` a move needs. */
export interface MovableServer {
  /** Asks the server to close the database; refused while an exam is live or grading runs. */
  releaseData(): Promise<{ ok: true } | { ok: false; message: string }>;
  stopAndWait(): Promise<void>;
  start(): void;
  /** Resolves `true` once the (re)started server reports `running`, `false` on timeout. */
  whenRunning(timeoutMs: number): Promise<boolean>;
}

const START_TIMEOUT_MS = 30_000;

const fail = (message: string): DataFolderMoveResult => ({ ok: false, message });

/**
 * Moves the data folder (M44): copy, verify, switch, delete the old one. Refused while an exam is
 * hosting or running (the server decides) and never overwrites data at the target. Until the
 * switch the old folder is untouched, so any failure goes back to it with the server restarted.
 */
export class DataFolderMover {
  private moving = false;

  constructor(
    private readonly folder: DataFolder,
    private readonly server: MovableServer,
  ) {}

  /** `picked`: the folder the teacher chose, or `null` for the profile folder. */
  async move(picked: string | null): Promise<DataFolderMoveResult> {
    if (this.moving) return fail('A move is already in progress.');
    this.moving = true;
    try {
      return await this.run(picked);
    } finally {
      this.moving = false;
    }
  }

  private async run(picked: string | null): Promise<DataFolderMoveResult> {
    const from = this.folder.current();
    if (picked !== null && !isAbsolute(picked)) return fail('Choose a folder on a drive.');
    const to = picked === null ? this.folder.defaultDir() : await targetFor(resolve(picked));
    if (samePath(from, to)) return fail('The data is already in that folder.');
    if (isInside(to, from)) return fail('Choose a folder outside the current data folder.');
    const clash = existingEntries(to);
    if (clash.length > 0) {
      return fail(
        `${to} already holds ExamGuard data (${clash.join(', ')}). Choose another folder.`,
      );
    }
    const bytes = [...(await listFiles(from)).values()].reduce((sum, n) => sum + n, 0);
    const space = await checkSpace(to, bytes);
    if (space) return fail(space);

    const released = await this.server.releaseData();
    if (!released.ok) return fail(released.message);
    await this.server.stopAndWait();

    try {
      await mkdir(to, { recursive: true });
      await copyData(from, to);
      const problem = await verifyCopy(from, to);
      if (problem) throw new Error(problem);
    } catch (err) {
      await removeData(to);
      this.server.start();
      return fail(`The data was not moved: ${message(err)}`);
    }

    this.folder.switchTo(to);
    this.server.start();
    if (!(await this.server.whenRunning(START_TIMEOUT_MS))) {
      // The server did not come up on the copy: back to the old folder, which is still whole.
      await this.server.stopAndWait();
      this.folder.switchTo(from);
      await removeData(to);
      this.server.start();
      return fail(
        'The exam server did not start from the new folder, so the data stayed where it was.',
      );
    }
    const leftBehind = await removeData(from);
    return { ok: true, path: to, leftBehind: leftBehind.length };
  }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

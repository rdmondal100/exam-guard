import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  IDLE_EXAM_FILES,
  checkFileName,
  type ExamFile,
  type ExamFilesStatus,
} from '@examguard/shared';
import { resolveInside } from '../files/safe-path.js';
import { DownloadError } from './pinned-download.js';

export interface ExamFileSyncDeps {
  /** Hidden folder for downloaded files that are not in the project folder yet. */
  stageDir(): string;
  /** The project folder (the exam workspace). */
  workspaceDir(): string;
  /** Downloads `file` to `destPath`, verified; throws a `DownloadError` on failure. */
  download(file: ExamFile, destPath: string): Promise<void>;
  onStatus?(status: ExamFilesStatus): void;
  sleep?(ms: number): Promise<void>;
  /** Waits between the attempts at one file; the number of entries is the number of retries. */
  retryDelaysMs?: number[];
  concurrency?: number;
}

/** Lists the files already copied into the project folder (kept in the staging folder). */
const REVEALED_FILE = 'revealed.json';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * Gets the teacher's exam files onto the student's PC (M15f). While the student waits in the
 * lobby (or later, if they joined late) each file is downloaded into a hidden staging folder;
 * once the exam runs, each is copied into the project folder, unless a file of that name is
 * already there. A copied file is recorded, so one the student deletes is not copied again after a
 * reconnect or a restart. One pass runs at a time; a change that arrives meanwhile runs after it.
 */
export class ExamFileSync {
  private current: ExamFilesStatus = IDLE_EXAM_FILES;
  private want: { files: ExamFile[]; reveal: boolean } | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(private readonly deps: ExamFileSyncDeps) {}

  get status(): ExamFilesStatus {
    return this.current;
  }

  /** The latest file list from the server; `reveal` is true once the exam is running. */
  update(files: ExamFile[], reveal: boolean): void {
    this.want = { files, reveal };
    this.start();
  }

  /** Tries again with the last list (the student's "Try again"). */
  retry(): void {
    this.start();
  }

  /** Resolves when no pass is going (for tests). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private start(): void {
    if (!this.want) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
    });
  }

  private async loop(): Promise<void> {
    do {
      this.again = false;
      const want = this.want;
      if (!want) return;
      try {
        await this.pass(want.files, want.reveal);
      } catch (e) {
        this.set({ state: 'failed', done: 0, total: want.files.length, message: messageOf(e) });
      }
    } while (this.again);
  }

  private set(next: ExamFilesStatus): void {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    this.deps.onStatus?.(next);
  }

  private async pass(files: ExamFile[], reveal: boolean): Promise<void> {
    const stage = this.deps.stageDir();
    await mkdir(stage, { recursive: true });
    const revealed = await this.readRevealed(stage);
    const total = files.length;
    if (total === 0) {
      this.set(IDLE_EXAM_FILES);
      return;
    }

    const pending = files.filter((f) => !revealed.has(f.id));
    const missing: ExamFile[] = [];
    let done = total - pending.length;
    for (const f of pending) {
      if (await exists(join(stage, f.id))) done++;
      else missing.push(f);
    }
    const problems: string[] = [];
    const failures: string[] = [];
    if (missing.length > 0) {
      this.set({ state: 'syncing', done, total });
      const queue = [...missing];
      const worker = async () => {
        for (let f = queue.shift(); f; f = queue.shift()) {
          const failure = await this.fetchOne(f, join(stage, f.id));
          if (failure) failures.push(failure);
          else done++;
          this.set({ state: 'syncing', done, total });
        }
      };
      const workers = Math.min(this.deps.concurrency ?? 2, queue.length);
      await Promise.all(Array.from({ length: workers }, worker));
    }

    if (reveal) {
      for (const f of pending) {
        const source = join(stage, f.id);
        if (!(await exists(source))) continue; // its download failed; the next pass tries again
        const note = await this.place(f, source);
        if (note) problems.push(note);
        revealed.add(f.id);
        await rm(source, { force: true });
      }
      await this.writeRevealed(stage, revealed);
    }
    await this.dropStale(stage, new Set(pending.map((f) => f.id)));

    const message = [...failures, ...problems].join('; ');
    this.set({
      state: failures.length > 0 ? 'failed' : 'done',
      done,
      total,
      ...(message ? { message } : {}),
    });
  }

  /** One file, with retries; the failure text, or `null` when it is staged. */
  private async fetchOne(file: ExamFile, dest: string): Promise<string | null> {
    const delays = this.deps.retryDelaysMs ?? [1000, 3000];
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let attempt = 0; ; attempt++) {
      try {
        await this.deps.download(file, dest);
        return null;
      } catch (e) {
        const retryable = !(e instanceof DownloadError) || e.retryable;
        if (!retryable || attempt >= delays.length) return `${file.name}: ${messageOf(e)}`;
        await sleep(delays[attempt] ?? 0);
      }
    }
  }

  /** Copies a staged file into the project folder; a note if it could not be placed. */
  private async place(file: ExamFile, source: string): Promise<string | null> {
    const problem = checkFileName(file.name);
    if (problem) return `${file.name}: ${problem}`;
    const workspace = this.deps.workspaceDir();
    try {
      await mkdir(workspace, { recursive: true });
      const target = await resolveInside(workspace, file.name);
      await copyFile(source, target, constants.COPYFILE_EXCL);
      return null;
    } catch (e) {
      // A file of that name is already there: it is the student's now and stays as it is.
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return null;
      return `${file.name}: ${messageOf(e)}`;
    }
  }

  private async readRevealed(stage: string): Promise<Set<string>> {
    try {
      const data: unknown = JSON.parse(await readFile(join(stage, REVEALED_FILE), 'utf8'));
      const ids = (data as { revealed?: unknown }).revealed;
      return new Set(
        Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [],
      );
    } catch {
      return new Set();
    }
  }

  private async writeRevealed(stage: string, revealed: Set<string>): Promise<void> {
    await writeFile(join(stage, REVEALED_FILE), JSON.stringify({ revealed: [...revealed] }));
  }

  /** Staged files of an older list, and half downloads, are not kept. */
  private async dropStale(stage: string, keep: Set<string>): Promise<void> {
    for (const name of await readdir(stage).catch(() => [])) {
      if (name !== REVEALED_FILE && !keep.has(name)) await rm(join(stage, name), { force: true });
    }
  }
}

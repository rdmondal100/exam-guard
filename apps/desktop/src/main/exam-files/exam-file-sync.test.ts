import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ExamFile, ExamFilesStatus } from '@examguard/shared';
import { ExamFileSync } from './exam-file-sync.js';
import { DownloadError } from './pinned-download.js';

const base = mkdtempSync(join(tmpdir(), 'eg-sync-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const file = (id: string, name: string): ExamFile => ({
  id,
  name,
  size: 1,
  sha256: 'a'.repeat(64),
});
const CSV = file('f1', 'data.csv');
const PNG = file('f2', 'logo.png');

let n = 0;
let stage: string;
let workspace: string;
let calls: string[];
let statuses: ExamFilesStatus[];
let behave: (file: ExamFile, attempt: number) => Promise<void> | void;
let sync: ExamFileSync;

beforeEach(() => {
  const root = join(base, `s${n++}`);
  stage = join(root, '.examguard', 'exam-files');
  workspace = join(root, 'workspace');
  calls = [];
  statuses = [];
  behave = () => {};
  sync = new ExamFileSync({
    stageDir: () => stage,
    workspaceDir: () => workspace,
    download: async (f, dest) => {
      calls.push(f.id);
      await behave(f, calls.filter((c) => c === f.id).length);
      await writeFile(dest, `bytes of ${f.name}`);
    },
    onStatus: (s) => statuses.push(s),
    sleep: async () => {},
    retryDelaysMs: [0, 0],
  });
});

const run = async (files: ExamFile[], reveal: boolean) => {
  sync.update(files, reveal);
  await sync.idle();
};
const read = (name: string) => readFileSync(join(workspace, name), 'utf8');

describe('ExamFileSync', () => {
  it('downloads into the staging folder in the lobby and leaves the project folder alone', async () => {
    await run([CSV, PNG], false);
    expect(sync.status).toEqual({ state: 'done', done: 2, total: 2 });
    expect((await readdir(stage)).sort()).toEqual(['f1', 'f2']);
    expect(existsSync(workspace)).toBe(false);
  });

  it('reports progress while it downloads', async () => {
    await run([CSV, PNG], false);
    expect(statuses[0]).toEqual({ state: 'syncing', done: 0, total: 2 });
    expect(statuses.at(-1)).toEqual({ state: 'done', done: 2, total: 2 });
    expect(statuses.some((s) => s.state === 'syncing' && s.done === 1)).toBe(true);
  });

  it('copies the staged files into the project folder once the exam runs', async () => {
    await run([CSV, PNG], false);
    await run([CSV, PNG], true);
    expect(calls).toEqual(['f1', 'f2']); // nothing was downloaded twice
    expect(read('data.csv')).toBe('bytes of data.csv');
    expect(read('logo.png')).toBe('bytes of logo.png');
    expect((await readdir(stage)).sort()).toEqual(['revealed.json']);
    expect(sync.status).toEqual({ state: 'done', done: 2, total: 2 });
  });

  it('downloads and copies in one pass for a student who joins after the start', async () => {
    await run([CSV], true);
    expect(read('data.csv')).toBe('bytes of data.csv');
  });

  it('does not bring back a file the student deleted, nor download it again', async () => {
    await run([CSV, PNG], true);
    rmSync(join(workspace, 'data.csv'));
    await run([CSV, PNG], true);
    sync.retry();
    await sync.idle();
    expect(existsSync(join(workspace, 'data.csv'))).toBe(false);
    expect(calls).toEqual(['f1', 'f2']);
  });

  it('remembers what was copied across a restart (a new instance, the same folders)', async () => {
    await run([CSV], true);
    rmSync(join(workspace, 'data.csv'));
    const restarted = new ExamFileSync({
      stageDir: () => stage,
      workspaceDir: () => workspace,
      download: async () => {
        throw new Error('must not download');
      },
    });
    restarted.update([CSV], true);
    await restarted.idle();
    expect(existsSync(join(workspace, 'data.csv'))).toBe(false);
    expect(restarted.status).toEqual({ state: 'done', done: 1, total: 1 });
  });

  it('keeps a file the student already has under that name', async () => {
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'data.csv'), 'my own work');
    await run([CSV], true);
    expect(read('data.csv')).toBe('my own work');
    expect(sync.status.state).toBe('done');
  });

  it('retries a failed download', async () => {
    behave = (_f, attempt) => {
      if (attempt < 3) throw new DownloadError('unreachable', 'network down');
    };
    await run([CSV], false);
    expect(calls).toEqual(['f1', 'f1', 'f1']);
    expect(sync.status).toEqual({ state: 'done', done: 1, total: 1 });
  });

  it('gives up after the retries, reports the file, and succeeds on Try again', async () => {
    let healthy = false;
    behave = () => {
      if (!healthy) throw new DownloadError('unreachable', 'network down');
    };
    await run([CSV, PNG], true);
    expect(sync.status.state).toBe('failed');
    expect(sync.status.message).toMatch(/data\.csv: network down/);
    expect(sync.status.done).toBe(0);
    expect(existsSync(join(workspace, 'data.csv'))).toBe(false);

    healthy = true;
    sync.retry();
    await sync.idle();
    expect(sync.status).toEqual({ state: 'done', done: 2, total: 2 });
    expect(read('data.csv')).toBe('bytes of data.csv');
  });

  it('does not retry a refusal that cannot change', async () => {
    behave = () => {
      throw new DownloadError('refused', 'The server answered 403', false);
    };
    await run([CSV], false);
    expect(calls).toEqual(['f1']);
    expect(sync.status).toMatchObject({ state: 'failed', message: /403/ });
  });

  it('still places the other files when one cannot be downloaded', async () => {
    behave = (f) => {
      if (f.id === 'f1') throw new DownloadError('bad_hash', 'wrong checksum', false);
    };
    await run([CSV, PNG], true);
    expect(read('logo.png')).toBe('bytes of logo.png');
    expect(existsSync(join(workspace, 'data.csv'))).toBe(false);
    expect(sync.status).toMatchObject({ state: 'failed', done: 1, total: 2 });
  });

  it.each(['..', 'a\\b', 'a/b', 'nul', 'x?.txt'])(
    'skips a file named %j and says so',
    async (name) => {
      const bad = file('bad1', name);
      await run([bad, CSV], true);
      expect(read('data.csv')).toBe('bytes of data.csv');
      expect(sync.status.state).toBe('done');
      expect(sync.status.message).toContain(name);
      // Nothing was written outside the project folder, and it is not retried forever.
      expect(existsSync(join(workspace, '..', 'a'))).toBe(false);
      sync.retry();
      await sync.idle();
      expect(calls.filter((c) => c === 'bad1')).toHaveLength(1);
    },
  );

  it('runs once more when a change arrives during a pass', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    behave = () => gate;
    sync.update([CSV], false);
    await new Promise((r) => setTimeout(r, 10));
    sync.update([CSV], true); // the exam started while the file was still downloading
    release();
    await sync.idle();
    expect(calls).toEqual(['f1']);
    expect(read('data.csv')).toBe('bytes of data.csv');
  });

  it('drops staged files of an older list and half downloads', async () => {
    await run([CSV, PNG], false);
    writeFileSync(join(stage, 'f9.part'), 'half');
    await run([CSV], false);
    expect((await readdir(stage)).sort()).toEqual(['f1']);
  });

  it('is idle with no files', async () => {
    await run([], true);
    expect(sync.status).toEqual({ state: 'idle', done: 0, total: 0 });
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { targetFor, verifyCopy, copyData } from './data-copy.js';
import { DataFolder } from './data-folder.js';
import { DataFolderMover, type MovableServer } from './data-folder-mover.js';
import { isInside, loadDataDir, locationFile, samePath } from './data-location.js';

let root: string;
let userData: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eg-data-'));
  userData = join(root, 'profile');
  mkdirSync(userData);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A small data folder plus Electron's own files, which must stay behind. */
function seed(dir: string): void {
  mkdirSync(join(dir, 'db'), { recursive: true });
  writeFileSync(join(dir, 'db', 'examguard.sqlite'), 'database');
  mkdirSync(join(dir, 'screenshots', 'e1', 's1'), { recursive: true });
  writeFileSync(join(dir, 'screenshots', 'e1', 's1', '1.jpg'), Buffer.from([0xff, 0xd8, 1]));
  writeFileSync(join(dir, 'secrets.bin'), 'sealed');
  writeFileSync(join(dir, 'mode.json'), '{"mode":"teacher"}');
}

/** Records the calls; `refuse` makes the server say the data is busy. */
function fakeServer(refuse: string | null = null, comesUp = true) {
  const calls: string[] = [];
  const server: MovableServer = {
    releaseData: () => {
      calls.push('release');
      return Promise.resolve(refuse ? { ok: false, message: refuse } : { ok: true });
    },
    stopAndWait: () => {
      calls.push('stop');
      return Promise.resolve();
    },
    start: () => {
      calls.push('start');
    },
    whenRunning: () => Promise.resolve(comesUp),
  };
  return { server, calls };
}

describe('data location pointer (M44)', () => {
  it('uses the profile folder until a move, then the saved folder', () => {
    expect(loadDataDir(userData)).toBe(userData);
    const folder = new DataFolder(userData);
    folder.switchTo(join(root, 'D'));
    expect(loadDataDir(userData)).toBe(join(root, 'D'));
    expect(new DataFolder(userData).info()).toEqual({ path: join(root, 'D'), isDefault: false });
    folder.switchTo(userData);
    expect(existsSync(locationFile(userData))).toBe(false);
  });

  it('ignores a damaged pointer', () => {
    writeFileSync(locationFile(userData), '{"dataDir": "relative\\\\path"}');
    expect(loadDataDir(userData)).toBe(userData);
    writeFileSync(locationFile(userData), 'not json');
    expect(loadDataDir(userData)).toBe(userData);
  });

  it('compares Windows paths without case and tells inside from beside', () => {
    expect(samePath('C:\\Data\\', 'c:\\data')).toBe(true);
    expect(isInside('C:\\Data\\sub', 'C:\\Data')).toBe(true);
    expect(isInside('C:\\DataX', 'C:\\Data')).toBe(false);
    expect(isInside('C:\\Data', 'C:\\Data')).toBe(false);
  });
});

describe('copy and verify', () => {
  it('uses an empty folder as it is and makes ExamGuard inside a full one', async () => {
    const empty = join(root, 'empty');
    mkdirSync(empty);
    expect(await targetFor(empty)).toBe(empty);
    expect(await targetFor(join(root, 'new'))).toBe(join(root, 'new'));
    seed(userData);
    expect(await targetFor(userData)).toBe(join(userData, 'ExamGuard'));
  });

  it('finds a changed file', async () => {
    seed(userData);
    const to = join(root, 'copy');
    await copyData(userData, to);
    expect(await verifyCopy(userData, to)).toBeNull();
    writeFileSync(join(to, 'secrets.bin'), 'sealeD');
    expect(await verifyCopy(userData, to)).toMatch(/secrets\.bin differs/);
    rmSync(join(to, 'secrets.bin'));
    expect(await verifyCopy(userData, to)).toMatch(/has 2 files/);
  });
});

describe('DataFolderMover', () => {
  it('copies, verifies, switches and deletes the old data, leaving Electron files alone', async () => {
    seed(userData);
    const folder = new DataFolder(userData);
    const { server, calls } = fakeServer();
    const target = join(root, 'D');
    const result = await new DataFolderMover(folder, server).move(target);
    expect(result).toEqual({ ok: true, path: target, leftBehind: 0 });
    expect(calls).toEqual(['release', 'stop', 'start']);
    expect(folder.current()).toBe(target);
    expect(readFileSync(join(target, 'db', 'examguard.sqlite'), 'utf8')).toBe('database');
    expect(existsSync(join(target, 'screenshots', 'e1', 's1', '1.jpg'))).toBe(true);
    expect(existsSync(join(userData, 'db'))).toBe(false);
    expect(existsSync(join(userData, 'mode.json'))).toBe(true);
    expect(existsSync(join(target, 'mode.json'))).toBe(false);

    // And back to the default.
    expect(await new DataFolderMover(folder, server).move(null)).toMatchObject({ ok: true });
    expect(folder.info().isDefault).toBe(true);
    expect(existsSync(join(userData, 'secrets.bin'))).toBe(true);
  });

  it('is refused while the server says the data is in use, and nothing changes', async () => {
    seed(userData);
    const folder = new DataFolder(userData);
    const { server, calls } = fakeServer('Stop hosting first: an exam is hosting or running.');
    const result = await new DataFolderMover(folder, server).move(join(root, 'D'));
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/Stop hosting/) });
    expect(calls).toEqual(['release']);
    expect(folder.current()).toBe(userData);
    expect(existsSync(join(root, 'D'))).toBe(false);
  });

  it('refuses a folder inside the data folder or one that already holds data', async () => {
    seed(userData);
    const folder = new DataFolder(userData);
    const { server, calls } = fakeServer();
    const mover = new DataFolderMover(folder, server);
    expect(await mover.move(join(userData, 'sub'))).toMatchObject({ ok: false });
    const other = join(root, 'other');
    seed(other);
    // `other` is not empty, so the target is other\ExamGuard; give that one data too.
    seed(join(other, 'ExamGuard'));
    expect(await mover.move(other)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/already holds ExamGuard data/),
    });
    expect(calls).toEqual([]);
  });

  it('goes back to the old folder when the server does not start from the copy', async () => {
    seed(userData);
    const folder = new DataFolder(userData);
    const { server, calls } = fakeServer(null, false);
    const target = join(root, 'D');
    const result = await new DataFolderMover(folder, server).move(target);
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/did not start/) });
    expect(calls).toEqual(['release', 'stop', 'start', 'stop', 'start']);
    expect(folder.current()).toBe(userData);
    expect(existsSync(join(userData, 'db', 'examguard.sqlite'))).toBe(true);
    expect(existsSync(join(target, 'db'))).toBe(false);
  });
});

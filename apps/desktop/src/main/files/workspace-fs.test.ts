import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FILE_LIMITS } from '@examguard/shared';
import { FilesError } from './files-error.js';
import { WorkspaceFiles } from './workspace-fs.js';

const base = mkdtempSync(join(tmpdir(), 'eg-files-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

let root: string;
let files: WorkspaceFiles;
let n = 0;
beforeEach(() => {
  root = join(base, `ws${n++}`);
  mkdirSync(root);
  files = new WorkspaceFiles(() => root);
});

describe('WorkspaceFiles', () => {
  it('creates the workspace on first use and lists folders before files', async () => {
    await files.create('b.txt', 'file');
    await files.create('a', 'dir');
    const list = await files.list('', false);
    expect(list.entries.map((e) => [e.name, e.kind])).toEqual([
      ['a', 'dir'],
      ['b.txt', 'file'],
    ]);
    expect(list.limitBytes).toBe(FILE_LIMITS.workspaceBytes);
  });

  it('hides dotfolders and package folders unless asked, and does not count them', async () => {
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    mkdirSync(join(root, '.msys'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'big.js'), 'x'.repeat(1000));
    writeFileSync(join(root, 'mine.txt'), '12345');
    mkdirSync(join(root, 'lib'));
    const shown = await files.list('', false);
    expect(shown.entries.map((e) => e.name)).toEqual(['lib', 'mine.txt']);
    expect(shown.usedBytes).toBe(5);
    const all = await files.list('', true);
    expect(all.entries.map((e) => e.name)).toEqual(['.msys', 'lib', 'node_modules', 'mine.txt']);
  });

  it('writes, reads back and flags images', async () => {
    await files.write('src/data.txt', 'héllo');
    expect(await files.read('src/data.txt')).toEqual({ kind: 'text', content: 'héllo' });
    writeFileSync(join(root, 'p.png'), Buffer.from([137, 80, 78, 71]));
    const read = await files.read('p.png');
    expect(read).toMatchObject({ kind: 'image' });
    expect(read.kind === 'image' && read.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const list = await files.list('', false);
    expect(list.entries.find((e) => e.name === 'p.png')?.image).toBe(true);
  });

  it('does not open binary or oversized files as text', async () => {
    writeFileSync(join(root, 'a.bin'), Buffer.from([1, 0, 2]));
    expect(await files.read('a.bin')).toMatchObject({ kind: 'unsupported' });
    writeFileSync(join(root, 'huge.txt'), 'x'.repeat(FILE_LIMITS.textBytes + 1));
    expect(await files.read('huge.txt')).toMatchObject({ kind: 'unsupported' });
    await expect(files.write('w.txt', 'x'.repeat(FILE_LIMITS.textBytes + 1))).rejects.toThrow(
      FilesError,
    );
  });

  it('refuses to create over an existing name', async () => {
    await files.create('a.txt', 'file');
    await expect(files.create('a.txt', 'file')).rejects.toThrow(/already used/);
    await expect(files.create('a.txt', 'dir')).rejects.toThrow(/already used/);
  });

  it('renames and removes, and refuses the workspace itself', async () => {
    await files.write('old.txt', 'x');
    await files.rename('old.txt', 'sub/new.txt');
    expect(existsSync(join(root, 'sub', 'new.txt'))).toBe(true);
    expect(existsSync(join(root, 'old.txt'))).toBe(false);
    await files.write('other.txt', 'y');
    await expect(files.rename('other.txt', 'sub/new.txt')).rejects.toThrow(/already used/);
    await files.remove('sub');
    expect(existsSync(join(root, 'sub'))).toBe(false);
    await expect(files.remove('')).rejects.toThrow(FilesError);
    await expect(files.rename('', 'x')).rejects.toThrow(FilesError);
  });

  it('refuses paths that climb out', async () => {
    await expect(files.read('../x')).rejects.toThrow(FilesError);
    await expect(files.write('..\\x', 'y')).rejects.toThrow(FilesError);
    await expect(files.remove('a/../../x')).rejects.toThrow(FilesError);
    expect(existsSync(join(root, '..', 'x'))).toBe(false);
  });

  it('stops saving when the folder is full, but lets a file shrink', async () => {
    const small = new WorkspaceFiles(() => root, 10);
    await small.write('a.txt', '123456');
    await expect(small.write('b.txt', '12345')).rejects.toThrow(/full/);
    await small.write('b.txt', '1234');
    // Rewriting a file counts only what it adds, so a full folder can still be edited down.
    await small.write('a.txt', '12');
    expect((await small.list('', false)).usedBytes).toBe(6);
  });
});

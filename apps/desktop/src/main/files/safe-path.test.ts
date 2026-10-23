import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FilesError } from './files-error.js';
import { pathParts, resolveInside } from './safe-path.js';

describe('pathParts', () => {
  it('splits on / and \\, and treats the empty path as the root', () => {
    expect(pathParts('')).toEqual([]);
    expect(pathParts('a/b\\c.txt')).toEqual(['a', 'b', 'c.txt']);
  });

  it.each([
    '..',
    '../x',
    'a/../b',
    'a/./b',
    '/etc',
    '\\share',
    'C:\\Windows',
    'C:x',
    'a//b',
    'a/',
    'nul',
    'a/COM1.txt',
    'x?.txt',
    'x*',
    'bad ',
    'dot.',
    'n'.repeat(121),
  ])('refuses %j', (rel) => {
    expect(() => pathParts(rel)).toThrow(FilesError);
  });
});

describe('resolveInside', () => {
  let root: string;
  beforeAll(() => {
    const base = mkdtempSync(join(tmpdir(), 'eg-safe-'));
    root = join(base, 'workspace');
    const outside = join(base, 'outside');
    mkdirSync(join(root, 'sub'), { recursive: true });
    mkdirSync(outside);
    // A junction needs no admin rights on Windows; elsewhere this is a plain symlink.
    symlinkSync(outside, join(root, 'link'), 'junction');
  });
  afterAll(() => rmSync(join(root, '..'), { recursive: true, force: true }));

  it('returns the absolute path, also for names that do not exist yet', async () => {
    expect(await resolveInside(root, 'sub/new.txt')).toBe(join(root, 'sub', 'new.txt'));
    expect(await resolveInside(root, '')).toBe(root);
  });

  it('refuses a junction that leads out of the workspace', async () => {
    await expect(resolveInside(root, 'link')).rejects.toThrow(FilesError);
    await expect(resolveInside(root, 'link/secret.txt')).rejects.toThrow(FilesError);
  });
});

import { describe, expect, it } from 'vitest';
import { baseName, crumbs, formatSize, isWithin, joinPath, movedPath, parentOf } from './filePaths';

describe('file paths', () => {
  it('joins and splits', () => {
    expect(joinPath('', 'a.txt')).toBe('a.txt');
    expect(joinPath('src/lib', 'a.txt')).toBe('src/lib/a.txt');
    expect(parentOf('src/lib/a.txt')).toBe('src/lib');
    expect(parentOf('a.txt')).toBe('');
    expect(baseName('src/lib/a.txt')).toBe('a.txt');
    expect(baseName('a.txt')).toBe('a.txt');
  });

  it('builds a breadcrumb from the root down', () => {
    expect(crumbs('')).toEqual([]);
    expect(crumbs('a/b')).toEqual([
      { name: 'a', path: 'a' },
      { name: 'b', path: 'a/b' },
    ]);
  });

  it('formats sizes', () => {
    expect(formatSize(12)).toBe('12 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('follows a renamed folder', () => {
    expect(isWithin('a/b.txt', 'a')).toBe(true);
    expect(isWithin('ab/c.txt', 'a')).toBe(false);
    expect(movedPath('a/b.txt', 'a', 'z')).toBe('z/b.txt');
    expect(movedPath('a', 'a', 'z')).toBe('z');
    expect(movedPath('ab/c.txt', 'a', 'z')).toBe('ab/c.txt');
  });
});

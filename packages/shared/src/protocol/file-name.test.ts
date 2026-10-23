import { describe, expect, it } from 'vitest';
import { FILE_NAME_MAX_CHARS, checkFileName } from './file-name.js';

describe('checkFileName', () => {
  it.each(['data.csv', 'logo.png', 'My notes (2).txt', 'a b.c', '.env', 'ünï.txt'])(
    'accepts %j',
    (name) => {
      expect(checkFileName(name)).toBeNull();
    },
  );

  it.each([
    '',
    '.',
    '..',
    'a/b',
    'a\\b',
    'C:x',
    'x?.txt',
    'x*',
    'a"b',
    'a|b',
    'a<b',
    'bad ',
    'dot.',
    'nul',
    'NUL.txt',
    'com1',
    'LPT9.log',
    'tab\there',
    'n'.repeat(FILE_NAME_MAX_CHARS + 1),
  ])('refuses %j', (name) => {
    expect(checkFileName(name)).not.toBeNull();
  });

  it('allows the longest name', () => {
    expect(checkFileName('n'.repeat(FILE_NAME_MAX_CHARS))).toBeNull();
  });
});

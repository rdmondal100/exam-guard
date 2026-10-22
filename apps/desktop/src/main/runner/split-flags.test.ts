import { describe, expect, it } from 'vitest';
import { splitFlags } from './split-flags.js';

describe('splitFlags', () => {
  it('splits on spaces and tabs and ignores extra blanks', () => {
    expect(splitFlags('  -lfreeglut   -lopengl32\t-lglu32 ')).toEqual([
      '-lfreeglut',
      '-lopengl32',
      '-lglu32',
    ]);
  });

  it('is empty for nothing', () => {
    expect(splitFlags('')).toEqual([]);
    expect(splitFlags('   ')).toEqual([]);
  });

  it('groups quoted text and keeps backslashes', () => {
    expect(splitFlags('-I"C:\\My Libs\\include" -DNAME=\'a b\'')).toEqual([
      '-IC:\\My Libs\\include',
      '-DNAME=a b',
    ]);
  });

  it('keeps an empty quoted argument', () => {
    expect(splitFlags('-x "" -y')).toEqual(['-x', '', '-y']);
  });

  it('does not treat shell characters as special', () => {
    expect(splitFlags('-lm && calc | x > y')).toEqual(['-lm', '&&', 'calc', '|', 'x', '>', 'y']);
  });

  it('refuses an unclosed quote and control characters', () => {
    expect(splitFlags('-I"C:\\libs')).toBeNull();
    expect(splitFlags('-lm\n-lx')).toBeNull();
    expect(splitFlags('-lm\u0000')).toBeNull();
  });
});

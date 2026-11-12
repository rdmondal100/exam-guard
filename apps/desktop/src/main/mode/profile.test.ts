import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProfile, userDataPathFor } from './profile.js';

describe('parseProfile', () => {
  it('defaults when the flag is missing', () => {
    expect(parseProfile(['electron', '.'])).toBe('default');
  });
  it('reads both flag forms', () => {
    expect(parseProfile(['--profile', 'teacher'])).toBe('teacher');
    expect(parseProfile(['--profile=student'])).toBe('student');
  });
  it('rejects bad names', () => {
    expect(() => parseProfile(['--profile', '../x'])).toThrow();
    expect(() => parseProfile(['--profile'])).toThrow();
    expect(() => parseProfile(['--profile=A B'])).toThrow();
  });
});

describe('userDataPathFor', () => {
  it('separates named profiles', () => {
    expect(userDataPathFor('/d', 'teacher')).toBe(join('/d', 'profiles', 'teacher'));
    expect(userDataPathFor('/d', 'default')).toBe('/d');
  });
});

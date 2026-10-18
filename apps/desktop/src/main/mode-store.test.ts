import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadStoredMode, modeFilePath, resolveMode, saveStoredMode } from './mode-store.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eg-mode-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('mode store', () => {
  it('round trips', async () => {
    expect(await loadStoredMode(dir)).toBeNull();
    await saveStoredMode(dir, 'teacher');
    expect(await loadStoredMode(dir)).toBe('teacher');
  });
  it('treats corrupt or invalid files as unset', async () => {
    await writeFile(modeFilePath(dir), '{nope', 'utf8');
    expect(await loadStoredMode(dir)).toBeNull();
    await writeFile(modeFilePath(dir), '{"mode":"admin"}', 'utf8');
    expect(await loadStoredMode(dir)).toBeNull();
  });
});

describe('resolveMode', () => {
  it('forces student on a student install', () => {
    expect(resolveMode('student', null)).toBe('student');
    expect(resolveMode('student', 'teacher')).toBe('student');
  });
  it('uses the stored mode otherwise', () => {
    expect(resolveMode('dev', 'teacher')).toBe('teacher');
    expect(resolveMode('teacher', null)).toBeNull();
  });
});

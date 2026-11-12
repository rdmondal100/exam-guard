import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadStoredTheme, saveStoredTheme, themeFilePath } from './themeStore.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-theme-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('theme store (M51)', () => {
  it('follows Windows when nothing is saved', async () => {
    expect(await loadStoredTheme(dir)).toBe('system');
  });

  it('keeps the saved choice', async () => {
    await saveStoredTheme(dir, 'dark');
    expect(await loadStoredTheme(dir)).toBe('dark');
    await saveStoredTheme(dir, 'light');
    expect(await loadStoredTheme(dir)).toBe('light');
  });

  it('falls back to system for a broken or unknown file', async () => {
    writeFileSync(themeFilePath(dir), '{ not json');
    expect(await loadStoredTheme(dir)).toBe('system');
    writeFileSync(themeFilePath(dir), JSON.stringify({ theme: 'blue' }));
    expect(await loadStoredTheme(dir)).toBe('system');
  });
});

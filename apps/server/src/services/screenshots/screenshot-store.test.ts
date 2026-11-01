import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScreenshotStore } from './screenshot-store.js';

let dir: string;
let store: ScreenshotStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-shots-'));
  store = new ScreenshotStore(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = async (path: string): Promise<Buffer> => {
  const stream = store.open(path);
  if (!stream) throw new Error('not opened');
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(part as Buffer);
  return Buffer.concat(parts);
};

describe('ScreenshotStore', () => {
  it('saves a picture under exam and student and reads it back by its relative path', async () => {
    const path = store.save('e1', 's1', 42, new Uint8Array([0xff, 0xd8, 1, 2, 3]));
    expect(path).toBe(join('screenshots', 'e1', 's1', '42.jpg'));
    expect(readFileSync(join(dir, path))).toEqual(Buffer.from([0xff, 0xd8, 1, 2, 3]));
    expect(await read(path)).toEqual(Buffer.from([0xff, 0xd8, 1, 2, 3]));
  });

  it('refuses ids that could leave the folder', () => {
    expect(() => store.save('..', 's1', 1, new Uint8Array([1]))).toThrow();
    expect(() => store.save('e1', 'a/b', 1, new Uint8Array([1]))).toThrow();
  });

  it('does not open a path outside the screenshots folder', () => {
    expect(store.open(join('screenshots', '..', 'examguard.sqlite'))).toBeNull();
    expect(store.open(join('..', 'secret.txt'))).toBeNull();
    expect(store.open('screenshots')).toBeNull();
  });

  it('deletes everything of one exam and nothing of another', () => {
    const a = store.save('e1', 's1', 1, new Uint8Array([1]));
    const b = store.save('e2', 's1', 2, new Uint8Array([2]));
    store.removeExam('e1');
    expect(existsSync(join(dir, a))).toBe(false);
    expect(existsSync(join(dir, b))).toBe(true);
    expect(() => store.removeExam('never-existed')).not.toThrow();
  });
});

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSecretBox, type SafeStorageLike } from '../resume/secret-box.js';
import { AiKeyStore } from './ai-key-store.js';

/** A stand-in for DPAPI: reversible, but the plain text never appears in the bytes. */
const fakeStorage = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (t) => Buffer.from([...Buffer.from(t, 'utf8')].map((b) => b ^ 0x5a)),
  decryptString: (d) => Buffer.from([...d].map((b) => b ^ 0x5a)).toString('utf8'),
});

const KEY = 'AIzaSyD-test-key-1234567890';
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-key-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const store = (storage = fakeStorage(), envKey: string | null = null) =>
  new AiKeyStore({
    dataDir: () => dir,
    box: createSecretBox(storage),
    encryptionAvailable: () => storage.isEncryptionAvailable(),
    envKey: () => envKey,
  });

describe('AI key store (M43)', () => {
  it('saves the key encrypted and reads it back; the file never holds the text', () => {
    const s = store();
    expect(s.status()).toEqual({ set: false, source: null, encryptionAvailable: true });
    expect(s.save(KEY)).toBe(true);
    expect(readFileSync(join(dir, 'secrets.bin'), 'utf8')).not.toContain(KEY);
    expect(store().key()).toBe(KEY);
    expect(store().status()).toMatchObject({ set: true, source: 'stored' });
    s.clear();
    expect(s.key()).toBeNull();
  });

  it('falls back to the dev variable, and the saved key wins over it', () => {
    expect(store(fakeStorage(), 'env-key-value').status()).toMatchObject({ source: 'env' });
    const s = store(fakeStorage(), 'env-key-value');
    s.save(KEY);
    expect(s.key()).toBe(KEY);
  });

  it('writes nothing when encryption is not available', () => {
    const s = store(fakeStorage(false));
    expect(s.save(KEY)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
    expect(s.status()).toEqual({ set: false, source: null, encryptionAvailable: false });
  });
});

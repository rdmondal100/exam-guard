import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSecretBox, type SecretBox } from './secret-box.js';
import { SessionStore, type StoredSession } from './session-store.js';

const box: SecretBox = {
  encrypt: (text) => Buffer.from(`enc:${text}`).toString('base64'),
  decrypt: (text) => {
    const plain = Buffer.from(text, 'base64').toString('utf8');
    return plain.startsWith('enc:') ? plain.slice(4) : null;
  },
};

const session: StoredSession = {
  target: { address: '192.168.1.20', port: 47820, expectedFingerprint: 'abc_DEF-123' },
  token: 'token-value-that-must-stay-secret',
  examStudentId: 'es1',
  name: 'Ada Lovelace',
  examTitle: 'Midterm',
};

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-session-'));
  file = join(dir, 'session', 'session.enc');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('SessionStore', () => {
  it('gives back what was saved', () => {
    new SessionStore(file, box).save(session);
    expect(new SessionStore(file, box).load()).toEqual(session);
  });

  it('keeps the token out of the file in clear text', () => {
    new SessionStore(file, box).save(session);
    expect(readFileSync(file, 'utf8')).not.toContain('token-value');
  });

  it('has nothing before the first save, and nothing after clear()', () => {
    const store = new SessionStore(file, box);
    expect(store.load()).toBeNull();
    store.save(session);
    store.clear();
    expect(store.load()).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });

  it('ignores a file it cannot decrypt or that is not a session', () => {
    new SessionStore(file, box).save(session);
    writeFileSync(file, 'garbage');
    expect(new SessionStore(file, box).load()).toBeNull();
    writeFileSync(file, box.encrypt('{"token":"x"}') ?? '');
    expect(new SessionStore(file, box).load()).toBeNull();
    writeFileSync(file, box.encrypt('not json') ?? '');
    expect(new SessionStore(file, box).load()).toBeNull();
  });

  it('writes nothing when encryption is not available', () => {
    new SessionStore(file, { encrypt: () => null, decrypt: () => null }).save(session);
    expect(new SessionStore(file, box).load()).toBeNull();
  });
});

describe('createSecretBox', () => {
  const storage = (available: boolean) => ({
    isEncryptionAvailable: () => available,
    encryptString: (text: string) => Buffer.from(text.split('').reverse().join('')),
    decryptString: (data: Buffer) => data.toString().split('').reverse().join(''),
  });

  it('round-trips through base64 text', () => {
    const b = createSecretBox(storage(true));
    const text = b.encrypt('héllo\nworld') ?? '';
    expect(text).not.toContain('\n');
    expect(b.decrypt(text)).toBe('héllo\nworld');
  });

  it('returns null when encryption is unavailable or the data is bad', () => {
    expect(createSecretBox(storage(false)).encrypt('x')).toBeNull();
    const failing = createSecretBox({
      ...storage(true),
      decryptString: () => {
        throw new Error('bad blob');
      },
    });
    expect(failing.decrypt('AAAA')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password-hash.js';

describe('password hash', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('correct horsE', hash)).toBe(false);
  });

  it('uses a fresh salt each time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects malformed stored hashes without throwing', async () => {
    const bad = [
      '',
      'plain',
      'scrypt$x$8$1$AA==$AA==',
      'bcrypt$1$2$3$AA==$AA==',
      'scrypt$32768$8$1$$',
    ];
    for (const encoded of bad) {
      expect(await verifyPassword('x', encoded)).toBe(false);
    }
  });
});

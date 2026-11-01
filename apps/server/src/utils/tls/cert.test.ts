import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateCert } from './cert.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-cert-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('loadOrCreateCert', () => {
  it('creates the files and a 4-char code', async () => {
    const cert = await loadOrCreateCert(dir);
    expect(existsSync(join(dir, 'certs', 'server.key'))).toBe(true);
    expect(existsSync(join(dir, 'certs', 'server.crt'))).toBe(true);
    expect(cert.fpCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(cert.fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('reuses the same cert next time', async () => {
    const first = await loadOrCreateCert(dir);
    const second = await loadOrCreateCert(dir);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it('replaces the cert on request', async () => {
    const first = await loadOrCreateCert(dir);
    const second = await loadOrCreateCert(dir, true);
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });
});

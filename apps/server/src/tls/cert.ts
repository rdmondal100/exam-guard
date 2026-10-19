import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { certDigest, fingerprintOf, fpCodeOf } from './fingerprint.js';

export interface ServerCert {
  key: string;
  cert: string;
  /** SHA-256 of the cert, base64url. */
  fingerprint: string;
  /** 4-character code the teacher and student screens compare by eye. */
  fpCode: string;
}

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function describe(key: string, cert: string): ServerCert {
  return { key, cert, fingerprint: fingerprintOf(cert), fpCode: fpCodeOf(certDigest(cert)) };
}

/**
 * The installation's ECDSA P-256 self-signed cert in `<dataDir>/certs/` (docs/architecture.md §2).
 * Created on first use and reused afterwards; `regenerate` replaces it. The key never leaves the PC.
 */
export async function loadOrCreateCert(dataDir: string, regenerate = false): Promise<ServerCert> {
  const dir = join(dataDir, 'certs');
  const keyPath = join(dir, 'server.key');
  const certPath = join(dir, 'server.crt');
  if (!regenerate && existsSync(keyPath) && existsSync(certPath)) {
    return describe(readFileSync(keyPath, 'utf8'), readFileSync(certPath, 'utf8'));
  }
  const now = new Date();
  const pems = await generate([{ name: 'commonName', value: 'ExamGuard' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    notAfterDate: new Date(now.getTime() + TEN_YEARS_MS),
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(keyPath, pems.private, { mode: 0o600 });
  writeFileSync(certPath, pems.cert);
  return describe(pems.private, pems.cert);
}

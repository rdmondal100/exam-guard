import { createHash, X509Certificate } from 'node:crypto';

export { fpCodeOf } from '@examguard/shared';

/** SHA-256 of the DER certificate. */
export function certDigest(certPem: string): Buffer {
  return createHash('sha256').update(new X509Certificate(certPem).raw).digest();
}

/** Fingerprint as base64url, the form carried in the mDNS TXT record. */
export function fingerprintOf(certPem: string): string {
  return certDigest(certPem).toString('base64url');
}

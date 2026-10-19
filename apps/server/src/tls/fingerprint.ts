import { createHash, X509Certificate } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** SHA-256 of the DER certificate. */
export function certDigest(certPem: string): Buffer {
  return createHash('sha256').update(new X509Certificate(certPem).raw).digest();
}

/** Fingerprint as base64url, the form carried in the mDNS TXT record. */
export function fingerprintOf(certPem: string): string {
  return certDigest(certPem).toString('base64url');
}

/** First 20 bits of the digest as 4 Crockford base32 characters, e.g. `7K2M`. */
export function fpCodeOf(digest: Buffer): string {
  const bits = (digest[0] ?? 0) * 4096 + (digest[1] ?? 0) * 16 + ((digest[2] ?? 0) >> 4);
  let code = '';
  for (let shift = 15; shift >= 0; shift -= 5) code += CROCKFORD[(bits >> shift) & 31];
  return code;
}

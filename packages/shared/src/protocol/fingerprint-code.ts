const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** First 20 bits of a SHA-256 digest as 4 Crockford base32 characters, e.g. `7K2M`. */
export function fpCodeOf(digest: Uint8Array): string {
  const bits = (digest[0] ?? 0) * 4096 + (digest[1] ?? 0) * 16 + ((digest[2] ?? 0) >> 4);
  let code = '';
  for (let shift = 15; shift >= 0; shift -= 5) code += CROCKFORD[(bits >> shift) & 31];
  return code;
}

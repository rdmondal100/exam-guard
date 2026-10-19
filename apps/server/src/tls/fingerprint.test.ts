import { describe, expect, it } from 'vitest';
import { fpCodeOf } from './fingerprint.js';

describe('fpCodeOf', () => {
  it('encodes the first 20 bits as 4 Crockford base32 chars', () => {
    expect(fpCodeOf(Buffer.from([0x00, 0x00, 0x00]))).toBe('0000');
    expect(fpCodeOf(Buffer.from([0xff, 0xff, 0xf0]))).toBe('ZZZZ');
    // 0011 1010 1001 1001 0101 -> 00111 01010 01100 10101 -> 7 A C N
    expect(fpCodeOf(Buffer.from([0x3a, 0x99, 0x50]))).toBe('7ACN');
  });

  it('ignores the bits after the first 20', () => {
    expect(fpCodeOf(Buffer.from([0x3a, 0x99, 0x5f, 0xaa]))).toBe('7ACN');
  });
});

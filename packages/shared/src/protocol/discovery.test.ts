import { describe, expect, it } from 'vitest';
import {
  MdnsTxtSchema,
  ProbeRequestSchema,
  ProbeResultSchema,
  parseTxtVersion,
  toMdnsTxt,
} from './discovery.js';

const FP = 'A'.repeat(43);

describe('mDNS TXT', () => {
  it('round-trips through the schema', () => {
    const txt = toMdnsTxt({ exam: 'Mid', fingerprint: FP }, '1.0');
    expect(MdnsTxtSchema.parse(txt)).toEqual({ v: '1.0', exam: 'Mid', fp: FP });
  });

  it('rejects a bad fingerprint or version', () => {
    expect(MdnsTxtSchema.safeParse({ v: '1.0', exam: 'x', fp: 'short' }).success).toBe(false);
    expect(MdnsTxtSchema.safeParse({ v: 'one', exam: 'x', fp: FP }).success).toBe(false);
  });

  it('parses the version', () => {
    expect(parseTxtVersion('1.4')).toEqual({ major: 1, minor: 4 });
  });
});

describe('probe', () => {
  it('validates a request', () => {
    expect(ProbeRequestSchema.safeParse({ address: '10.0.0.5' }).success).toBe(true);
    expect(ProbeRequestSchema.safeParse({ address: '' }).success).toBe(false);
    expect(ProbeRequestSchema.safeParse({ address: 'h', port: 70000 }).success).toBe(false);
  });

  it('accepts both result shapes', () => {
    expect(
      ProbeResultSchema.safeParse({ ok: false, code: 'fingerprint_mismatch', message: 'm' })
        .success,
    ).toBe(true);
    expect(ProbeResultSchema.safeParse({ ok: false, code: 'nope', message: 'm' }).success).toBe(
      false,
    );
  });
});

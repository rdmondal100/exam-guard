import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  ProtocolVersionSchema,
  isProtocolCompatible,
} from './protocol-version.js';

describe('ProtocolVersionSchema', () => {
  it('accepts the current version', () => {
    expect(ProtocolVersionSchema.parse(PROTOCOL_VERSION)).toEqual({ major: 5, minor: 0 });
  });

  it('rejects non-integer and negative parts', () => {
    expect(ProtocolVersionSchema.safeParse({ major: 1.5, minor: 0 }).success).toBe(false);
    expect(ProtocolVersionSchema.safeParse({ major: 1, minor: -1 }).success).toBe(false);
    expect(ProtocolVersionSchema.safeParse({ major: '1', minor: 0 }).success).toBe(false);
  });
});

describe('isProtocolCompatible', () => {
  it('accepts a different minor', () => {
    expect(isProtocolCompatible({ major: 5, minor: 7 })).toBe(true);
  });

  it('rejects a different major (1 = the app with the Rust agent)', () => {
    expect(isProtocolCompatible({ major: 1, minor: 0 })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { AuthLoginBodySchema, AuthSetupBodySchema, AuthStatusSchema } from './auth.js';

describe('auth schemas', () => {
  it('requires a setup password of at least 8 characters', () => {
    expect(AuthSetupBodySchema.safeParse({ password: 'short' }).success).toBe(false);
    expect(AuthSetupBodySchema.safeParse({ password: 'long-enough' }).success).toBe(true);
  });

  it('accepts any string on login but not a missing one', () => {
    expect(AuthLoginBodySchema.safeParse({ password: 'x' }).success).toBe(true);
    expect(AuthLoginBodySchema.safeParse({}).success).toBe(false);
  });

  it('parses the status', () => {
    expect(AuthStatusSchema.parse({ setupRequired: true, loggedIn: false })).toEqual({
      setupRequired: true,
      loggedIn: false,
    });
  });
});

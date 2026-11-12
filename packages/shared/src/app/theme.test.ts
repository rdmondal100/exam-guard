import { describe, expect, it } from 'vitest';
import { ThemeSetRequestSchema, ThemeSourceSchema } from './theme.js';

describe('ThemeSourceSchema (M51)', () => {
  it('accepts system, light and dark', () => {
    for (const theme of ['system', 'light', 'dark']) {
      expect(ThemeSourceSchema.safeParse(theme).success).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(ThemeSourceSchema.safeParse('blue').success).toBe(false);
    expect(ThemeSetRequestSchema.safeParse({ theme: '' }).success).toBe(false);
    expect(ThemeSetRequestSchema.safeParse({}).success).toBe(false);
  });
});

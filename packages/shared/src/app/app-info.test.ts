import { describe, expect, it } from 'vitest';
import { AppInfoSchema } from './app-info.js';

describe('AppInfoSchema (M52)', () => {
  it('accepts the teacher and the student app', () => {
    for (const app of ['teacher', 'student']) {
      expect(AppInfoSchema.safeParse({ app, profile: 'default', version: '0.2.0' }).success).toBe(
        true,
      );
    }
  });

  it('rejects an unknown app or a missing version', () => {
    expect(AppInfoSchema.safeParse({ app: 'admin', profile: 'x', version: '1' }).success).toBe(
      false,
    );
    expect(AppInfoSchema.safeParse({ app: 'teacher', profile: 'x' }).success).toBe(false);
  });
});

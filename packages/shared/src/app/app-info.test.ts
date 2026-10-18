import { describe, expect, it } from 'vitest';
import { AppInfoSchema, SetModeRequestSchema, allowedModesFor } from './app-info.js';

describe('allowedModesFor', () => {
  it('locks student installs to Student mode', () => {
    expect(allowedModesFor('student')).toEqual(['student']);
  });
  it('allows both modes otherwise', () => {
    expect(allowedModesFor('teacher')).toEqual(['teacher', 'student']);
    expect(allowedModesFor('dev')).toEqual(['teacher', 'student']);
  });
});

describe('schemas', () => {
  it('accepts a null mode before the first choice', () => {
    const info = { mode: null, installType: 'dev', allowedModes: ['teacher'], profile: 'x' };
    expect(AppInfoSchema.safeParse(info).success).toBe(true);
  });
  it('rejects unknown modes', () => {
    expect(SetModeRequestSchema.safeParse({ mode: 'admin' }).success).toBe(false);
  });
});

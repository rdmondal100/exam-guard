import { describe, expect, it } from 'vitest';
import { AiKeySetRequestSchema } from '../app/ai-key.js';
import { RUN_LIMITS } from '../app/runner.js';
import {
  DEFAULT_RUN_LIMITS,
  DEFAULT_SETTINGS,
  RunLimitsSchema,
  SettingsPatchSchema,
  TeacherSettingsSchema,
} from './settings.js';

describe('settings schemas (M43)', () => {
  it('the defaults are valid and keep the old run-limit constants', () => {
    expect(TeacherSettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_RUN_LIMITS).toMatchObject({
      timeMs: RUN_LIMITS.timeMs,
      memoryMb: RUN_LIMITS.memoryMb,
    });
  });

  it('refuses limits out of range, unknown providers and odd model names', () => {
    expect(RunLimitsSchema.safeParse({ ...DEFAULT_RUN_LIMITS, timeMs: 1000 }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ ai: { provider: 'other', model: 'x' } }).success).toBe(
      false,
    );
    expect(
      SettingsPatchSchema.safeParse({ ai: { provider: 'gemini', model: 'a b' } }).success,
    ).toBe(false);
    expect(SettingsPatchSchema.safeParse({ server: { studentPort: 80 } }).success).toBe(false);
    expect(SettingsPatchSchema.parse({})).toEqual({});
  });

  it('accepts a plausible API key but not one with spaces', () => {
    expect(AiKeySetRequestSchema.safeParse({ apiKey: ' AIzaSyD-abc_123456 ' }).success).toBe(true);
    expect(AiKeySetRequestSchema.safeParse({ apiKey: 'AIza SyD abc 123' }).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  TERMINAL_LIMITS,
  TerminalExitSchema,
  TerminalInputSchema,
  TerminalOpenResultSchema,
  TerminalSizeSchema,
} from './terminal.js';

describe('TerminalSizeSchema', () => {
  it('accepts a normal grid', () => {
    expect(TerminalSizeSchema.safeParse({ cols: 120, rows: 30 }).success).toBe(true);
  });

  it.each([
    { cols: 1, rows: 30 },
    { cols: 120, rows: 0 },
    { cols: 120.5, rows: 30 },
    { cols: 501, rows: 30 },
    { cols: 120 },
  ])('rejects %#', (bad) => {
    expect(TerminalSizeSchema.safeParse(bad).success).toBe(false);
  });
});

describe('TerminalInputSchema', () => {
  it('caps pasted input', () => {
    expect(TerminalInputSchema.safeParse('npm i lodash\r').success).toBe(true);
    expect(
      TerminalInputSchema.safeParse('x'.repeat(TERMINAL_LIMITS.maxInputChars + 1)).success,
    ).toBe(false);
  });
});

describe('TerminalOpenResultSchema', () => {
  it('needs a message when refused', () => {
    expect(TerminalOpenResultSchema.safeParse({ ok: true }).success).toBe(true);
    expect(TerminalOpenResultSchema.safeParse({ ok: false, message: 'no' }).success).toBe(true);
    expect(TerminalOpenResultSchema.safeParse({ ok: false }).success).toBe(false);
  });
});

describe('TerminalExitSchema', () => {
  it('accepts a killed shell without an exit code', () => {
    expect(TerminalExitSchema.safeParse({ exitCode: null, reason: 'closed' }).success).toBe(true);
    expect(TerminalExitSchema.safeParse({ exitCode: 0, reason: 'gone' }).success).toBe(false);
  });
});

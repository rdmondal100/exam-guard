import { describe, expect, it } from 'vitest';
import { MAX_RUN_CODE_CHARS, RunRequestSchema, RunResultSchema } from './runner.js';

const request = { questionId: 'q1', language: 'cpp', code: 'int main(){}', stdin: '' };

describe('RunRequestSchema', () => {
  it('accepts an allowed language', () => {
    expect(RunRequestSchema.safeParse(request).success).toBe(true);
  });

  it.each([
    { ...request, language: 'python' },
    { ...request, questionId: '' },
    { ...request, code: 'x'.repeat(MAX_RUN_CODE_CHARS + 1) },
  ])('rejects %#', (bad) => {
    expect(RunRequestSchema.safeParse(bad).success).toBe(false);
  });
});

describe('RunResultSchema', () => {
  it('accepts a compile error with diagnostics', () => {
    const result = {
      status: 'compile_error',
      exitCode: null,
      timeMs: null,
      stdout: '',
      stderr: '',
      compileOutput: 'main.c:3:5: error: x',
      diagnostics: [{ line: 3, col: 5, severity: 'error', message: 'x' }],
      message: 'Compile failed',
    };
    expect(RunResultSchema.safeParse(result).success).toBe(true);
    expect(
      RunResultSchema.safeParse({
        ...result,
        diagnostics: [{ line: 0, col: 1, severity: 'error', message: '' }],
      }).success,
    ).toBe(false);
  });
});

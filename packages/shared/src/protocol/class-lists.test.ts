import { describe, expect, it } from 'vitest';
import { ClassListImportBodySchema, ClassListImportResultSchema } from './class-lists.js';

describe('ClassListImportBodySchema', () => {
  it('trims the name and accepts dryRun', () => {
    const body = ClassListImportBodySchema.parse({
      name: '  CSE 101 ',
      csvText: 'a,b',
      dryRun: true,
    });
    expect(body.name).toBe('CSE 101');
    expect(body.dryRun).toBe(true);
  });

  it('rejects a blank name and a missing csvText', () => {
    expect(ClassListImportBodySchema.safeParse({ name: '  ', csvText: '' }).success).toBe(false);
    expect(ClassListImportBodySchema.safeParse({ name: 'x' }).success).toBe(false);
  });
});

describe('ClassListImportResultSchema', () => {
  it('accepts a dry-run preview without a list', () => {
    const result = ClassListImportResultSchema.parse({
      rows: [{ studentCode: '1', name: 'A' }],
      errors: [{ line: 3, code: 'blank_id', message: 'Student ID is blank', raw: ',Bob' }],
    });
    expect(result.list).toBeUndefined();
  });

  it('rejects an unknown error code', () => {
    const bad = { rows: [], errors: [{ line: 1, code: 'nope', message: '', raw: '' }] };
    expect(ClassListImportResultSchema.safeParse(bad).success).toBe(false);
  });
});

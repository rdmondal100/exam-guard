import { describe, expect, it } from 'vitest';
import { EXAM_FILE_LIMITS, ExamFileSchema, ExamFilesSchema } from './exam-files.js';

const file = { id: 'f1', name: 'data.csv', size: 10, sha256: 'a'.repeat(64) };

describe('exam file schemas', () => {
  it('accepts a file and a list', () => {
    expect(ExamFileSchema.safeParse(file).success).toBe(true);
    expect(ExamFilesSchema.safeParse([file, { ...file, id: 'f2', name: 'b.png' }]).success).toBe(
      true,
    );
  });

  it('rejects a bad hash, a negative or oversize file, and an empty name', () => {
    expect(ExamFileSchema.safeParse({ ...file, sha256: 'xyz' }).success).toBe(false);
    expect(ExamFileSchema.safeParse({ ...file, sha256: 'A'.repeat(64) }).success).toBe(false);
    expect(ExamFileSchema.safeParse({ ...file, size: -1 }).success).toBe(false);
    expect(
      ExamFileSchema.safeParse({ ...file, size: EXAM_FILE_LIMITS.fileBytes + 1 }).success,
    ).toBe(false);
    expect(ExamFileSchema.safeParse({ ...file, name: '' }).success).toBe(false);
  });

  it('caps the list', () => {
    const many = Array.from({ length: EXAM_FILE_LIMITS.count + 1 }, (_, i) => ({
      ...file,
      id: `f${i}`,
    }));
    expect(ExamFilesSchema.safeParse(many).success).toBe(false);
  });
});

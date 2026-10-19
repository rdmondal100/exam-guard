import { describe, expect, it } from 'vitest';
import { ExamCreateBodySchema, ExamStateSchema, ExamUpdateBodySchema } from './exams.js';

describe('exam schemas', () => {
  it('accepts a minimal create body and trims the title', () => {
    const body = ExamCreateBodySchema.parse({ title: '  Midterm ', durationMin: 90 });
    expect(body.title).toBe('Midterm');
  });

  it('rejects an empty title and out-of-range durations', () => {
    expect(ExamCreateBodySchema.safeParse({ title: ' ', durationMin: 90 }).success).toBe(false);
    expect(ExamCreateBodySchema.safeParse({ title: 'x', durationMin: 0 }).success).toBe(false);
    expect(ExamCreateBodySchema.safeParse({ title: 'x', durationMin: 601 }).success).toBe(false);
    expect(ExamCreateBodySchema.safeParse({ title: 'x', durationMin: 1.5 }).success).toBe(false);
  });

  it('allows a partial update and a null class list', () => {
    expect(ExamUpdateBodySchema.safeParse({}).success).toBe(true);
    expect(ExamUpdateBodySchema.safeParse({ classListId: null }).success).toBe(true);
  });

  it('knows the eight states', () => {
    expect(ExamStateSchema.options).toHaveLength(8);
  });
});

import { describe, expect, it } from 'vitest';
import { CriterionSchema, QuestionBodySchema } from './questions.js';

const CODE = {
  type: 'code',
  body: 'Reverse a string',
  allowedLanguages: ['c', 'js'],
  studentNote: '',
  sampleAnswer: 'x',
  sampleLanguage: 'c',
  aiNotes: '',
  criteria: [{ name: 'Correct', maxMarks: 2.5 }],
};

describe('question schemas', () => {
  it('takes half marks and rejects other fractions, zero and negatives', () => {
    expect(CriterionSchema.safeParse({ name: 'a', maxMarks: 0.5 }).success).toBe(true);
    expect(CriterionSchema.safeParse({ name: 'a', maxMarks: 1.25 }).success).toBe(false);
    expect(CriterionSchema.safeParse({ name: 'a', maxMarks: 0 }).success).toBe(false);
    expect(CriterionSchema.safeParse({ name: 'a', maxMarks: -1 }).success).toBe(false);
  });

  it('accepts a code question and a written one', () => {
    expect(QuestionBodySchema.safeParse(CODE).success).toBe(true);
    const written = { ...CODE, type: 'written', allowedLanguages: [], sampleLanguage: 'text' };
    expect(QuestionBodySchema.safeParse(written).success).toBe(true);
  });

  it('refuses languages on a written question and duplicate languages or criteria', () => {
    expect(QuestionBodySchema.safeParse({ ...CODE, type: 'written' }).success).toBe(false);
    expect(QuestionBodySchema.safeParse({ ...CODE, allowedLanguages: ['c', 'c'] }).success).toBe(
      false,
    );
    const dup = [
      { name: 'A', maxMarks: 1 },
      { name: 'a', maxMarks: 1 },
    ];
    expect(QuestionBodySchema.safeParse({ ...CODE, criteria: dup }).success).toBe(false);
  });

  it('lets an unfinished draft question be saved (empty answer, no criteria)', () => {
    const draft = { ...CODE, sampleAnswer: '', criteria: [], allowedLanguages: [] };
    expect(QuestionBodySchema.safeParse(draft).success).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CriterionSchema,
  QuestionBodySchema,
  StudentQuestionSchema,
  toStudentQuestion,
  type Question,
} from './questions.js';

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

  it('takes every runnable language, Python included, and nothing else', () => {
    const all = { ...CODE, allowedLanguages: ['c', 'cpp', 'js', 'py'] };
    expect(QuestionBodySchema.safeParse(all).success).toBe(true);
    const java = { ...CODE, allowedLanguages: ['java'] };
    expect(QuestionBodySchema.safeParse(java).success).toBe(false);
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

describe('toStudentQuestion', () => {
  const full: Question = {
    id: 'q1',
    examId: 'e1',
    position: 1,
    type: 'code',
    body: 'Reverse a string',
    marks: 2.5,
    allowedLanguages: ['c', 'js'],
    studentNote: 'Use stdin',
    sampleAnswer: 'secret answer',
    sampleLanguage: 'c',
    aiNotes: 'secret notes',
    criteria: [{ name: 'Correct', maxMarks: 2.5 }],
  };

  it('keeps what a student may see and drops the answer, criteria and AI notes', () => {
    const out = toStudentQuestion(full);
    expect(StudentQuestionSchema.safeParse(out).success).toBe(true);
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(out).not.toHaveProperty('criteria');
    expect(out).not.toHaveProperty('examId');
    expect(out).toMatchObject({ id: 'q1', position: 1, marks: 2.5, studentNote: 'Use stdin' });
  });
});

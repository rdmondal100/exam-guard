import { describe, expect, it } from 'vitest';
import type { Question } from '@examguard/shared';
import { readyProblems } from './ready-check.js';

const GOOD: Question = {
  id: 'q1',
  examId: 'e',
  position: 1,
  type: 'code',
  body: 'b',
  marks: 2,
  allowedLanguages: ['c'],
  studentNote: '',
  sampleAnswer: 'int main(){}',
  sampleLanguage: 'c',
  aiNotes: '',
  criteria: [{ name: 'Works', maxMarks: 2 }],
};
const codes = (list: ReturnType<typeof readyProblems>) => list.map((p) => p.code);

describe('readyProblems', () => {
  it('is empty for a complete exam', () => {
    expect(readyProblems({ classListId: 'l' }, [GOOD])).toEqual([]);
  });

  it('reports a missing class list and no questions', () => {
    expect(codes(readyProblems({ classListId: null }, []))).toEqual([
      'no_class_list',
      'no_questions',
    ]);
  });

  it('reports per-question problems with the question id', () => {
    const bad: Question = { ...GOOD, sampleAnswer: '  ', criteria: [], allowedLanguages: [] };
    const problems = readyProblems({ classListId: 'l' }, [bad]);
    expect(codes(problems)).toEqual(['missing_sample_answer', 'no_criteria', 'no_languages']);
    expect(problems.every((p) => p.questionId === 'q1')).toBe(true);
  });

  it('does not ask a written question for languages', () => {
    const written: Question = { ...GOOD, type: 'written', allowedLanguages: [] };
    expect(readyProblems({ classListId: 'l' }, [written])).toEqual([]);
  });
});

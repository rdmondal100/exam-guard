import { describe, expect, it } from 'vitest';
import type { AnswerSnapshot } from '@examguard/shared';
import { chooseFinalAnswers } from './choose-final.js';

const code = {
  id: 'q1',
  type: 'code' as const,
  allowedLanguages: ['c', 'cpp'] as ('c' | 'cpp')[],
};
const written = { id: 'q2', type: 'written' as const, allowedLanguages: [] as 'c'[] };
const buffer = (questionId: string, language: string, content: string, clientSeq: number) => ({
  questionId,
  language,
  content,
  flags: null,
  clientSeq,
});

describe('chooseFinalAnswers', () => {
  it('takes the language saved as selected, not the newest buffer', () => {
    const snapshot: AnswerSnapshot = {
      buffers: [buffer('q1', 'c', 'int c;', 1), buffer('q1', 'cpp', 'int cpp;', 3)],
      selected: [{ questionId: 'q1', language: 'c', clientSeq: 4 }],
    };
    expect(chooseFinalAnswers([code], snapshot)).toEqual([
      { questionId: 'q1', language: 'c', content: 'int c;' },
    ]);
  });

  it('falls back to the newest buffer when none was ever selected', () => {
    const snapshot: AnswerSnapshot = {
      buffers: [buffer('q1', 'c', 'old', 1), buffer('q1', 'cpp', 'new', 2)],
      selected: [],
    };
    expect(chooseFinalAnswers([code], snapshot)[0]).toMatchObject({
      language: 'cpp',
      content: 'new',
    });
  });

  it('gives an unanswered question an empty answer in its first allowed language', () => {
    const empty: AnswerSnapshot = { buffers: [], selected: [] };
    expect(chooseFinalAnswers([code, written], empty)).toEqual([
      { questionId: 'q1', language: 'c', content: '' },
      { questionId: 'q2', language: 'text', content: '' },
    ]);
  });

  it('keeps the selected language of a question whose buffer is missing', () => {
    const snapshot: AnswerSnapshot = {
      buffers: [],
      selected: [{ questionId: 'q1', language: 'cpp', clientSeq: 1 }],
    };
    expect(chooseFinalAnswers([code], snapshot)[0]).toEqual({
      questionId: 'q1',
      language: 'cpp',
      content: '',
    });
  });

  it('returns one answer per question, in question order, and ignores other questions', () => {
    const snapshot: AnswerSnapshot = {
      buffers: [buffer('q2', 'text', 'essay', 1), buffer('other', 'c', 'x', 2)],
      selected: [{ questionId: 'q2', language: 'text', clientSeq: 1 }],
    };
    expect(chooseFinalAnswers([code, written], snapshot).map((a) => a.questionId)).toEqual([
      'q1',
      'q2',
    ]);
  });
});

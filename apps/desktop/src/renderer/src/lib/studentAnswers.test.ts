import { describe, expect, it } from 'vitest';
import type { StudentAnswersResponse } from '@examguard/shared';
import { answeredText, answersSourceText, refreshesLive } from './studentAnswers';

const answer = (answered: boolean) => ({
  questionId: 'q',
  position: 1,
  type: 'written' as const,
  body: 'Q',
  maxMarks: 2,
  language: answered ? 'text' : null,
  content: answered ? 'x' : '',
  answered,
  savedAt: answered ? 1 : null,
  grade: null,
});

const latest: StudentAnswersResponse = {
  source: 'latest',
  submittedAt: null,
  receiptHash: null,
  answers: [answer(true), answer(false)],
};
const final: StudentAnswersResponse = {
  ...latest,
  source: 'final',
  submittedAt: new Date(2026, 10, 20, 10, 41, 59).getTime(),
  receiptHash: 'a'.repeat(64),
};

describe('student answer sheet texts (M65)', () => {
  it('says whether these are final answers or the live autosave', () => {
    expect(answersSourceText(final, true)).toMatch(/^Submitted at .*receipt aaaaaaaaaaaa…/);
    expect(answersSourceText(latest, true)).toMatch(/refreshed every 10 s/);
    expect(answersSourceText(latest, false)).toMatch(/last autosave/);
  });

  it('counts the answered questions', () => {
    expect(answeredText(latest)).toBe('1 of 2 answered');
  });

  it('polls only while the student is still writing a running exam', () => {
    expect(refreshesLive(latest, true)).toBe(true);
    expect(refreshesLive(null, true)).toBe(true);
    expect(refreshesLive(final, true)).toBe(false);
    expect(refreshesLive(latest, false)).toBe(false);
  });
});

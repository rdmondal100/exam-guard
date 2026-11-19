import { describe, expect, it } from 'vitest';
import type { StudentQuestion } from '@examguard/shared';
import { addedQuestionsText, newQuestions } from './addedQuestions';

const q = (id: string, position: number) => ({ id, position }) as StudentQuestion;

describe('added questions (M58)', () => {
  it('finds the questions not seen before, in order', () => {
    const list = [q('a', 1), q('b', 2), q('c', 3)];
    expect(newQuestions(new Set(['a']), list).map((x) => x.id)).toEqual(['b', 'c']);
    expect(newQuestions(new Set(['a', 'b', 'c']), list)).toEqual([]);
  });

  it('names one or several new questions', () => {
    expect(addedQuestionsText([q('d', 4)])).toBe('Your teacher added Question 4.');
    expect(addedQuestionsText([q('e', 5), q('d', 4)])).toBe(
      'Your teacher added Questions 4 and 5.',
    );
    expect(addedQuestionsText([q('d', 4), q('e', 5), q('f', 6)])).toBe(
      'Your teacher added Questions 4, 5 and 6.',
    );
  });
});

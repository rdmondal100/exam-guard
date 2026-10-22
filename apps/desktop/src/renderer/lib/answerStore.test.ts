import { beforeEach, describe, expect, it } from 'vitest';
import { ANSWER_TEXT_KEY, answeredIds, getAnswer, useAnswerStore } from './answerStore';

const state = () => useAnswerStore.getState();

beforeEach(() => state().reset());

describe('answer store', () => {
  it('restores the C++ code after switching to JS and back', () => {
    state().setLanguage('q1', 'cpp');
    state().setAnswer('q1', 'cpp', 'int main() {}');
    state().setLanguage('q1', 'js');
    state().setAnswer('q1', 'js', 'console.log(1)');
    state().setLanguage('q1', 'cpp');

    expect(state().languages.q1).toBe('cpp');
    expect(getAnswer(state().answers, 'q1', 'cpp')).toBe('int main() {}');
    expect(getAnswer(state().answers, 'q1', 'js')).toBe('console.log(1)');
  });

  it('keeps questions separate', () => {
    state().setAnswer('q1', 'c', 'a');
    state().setAnswer('q2', 'c', 'b');
    expect(getAnswer(state().answers, 'q1', 'c')).toBe('a');
    expect(getAnswer(state().answers, 'q2', 'c')).toBe('b');
  });

  it('keeps flags per question and language, and clears them with the rest', () => {
    state().setFlags('q1', 'c', '-lm');
    state().setFlags('q1', 'cpp', '-lfreeglut');
    state().setFlags('q2', 'c', '-O3');
    expect(state().flags).toEqual({ q1: { c: '-lm', cpp: '-lfreeglut' }, q2: { c: '-O3' } });
    state().setFlags('q1', 'c', '');
    expect(state().flags.q1?.c).toBe('');
    state().reset();
    expect(state().flags).toEqual({});
  });

  it('returns an empty string for an unseen buffer', () => {
    expect(getAnswer(state().answers, 'nope', 'c')).toBe('');
  });

  it('counts only the selected buffer and ignores whitespace', () => {
    state().setAnswer('q1', 'c', 'x');
    state().setAnswer('q1', 'js', '   ');
    state().setAnswer('q2', ANSWER_TEXT_KEY, 'essay');
    state().setAnswer('q3', 'cpp', 'y');

    const keyOf = (id: string) => ({ q1: 'js', q2: ANSWER_TEXT_KEY, q3: 'cpp' })[id] ?? '';
    expect([...answeredIds(state().answers, keyOf)].sort()).toEqual(['q2', 'q3']);
  });

  it('reset clears everything', () => {
    state().setAnswer('q1', 'c', 'x');
    state().setLanguage('q1', 'c');
    state().reset();
    expect(state().answers).toEqual({});
    expect(state().languages).toEqual({});
  });
});

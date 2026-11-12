import { describe, expect, it } from 'vitest';
import { draftToBody, draftTotal, emptyDraft, parseMarks } from './questionDraft';

describe('parseMarks', () => {
  it('accepts positive multiples of 0.5', () => {
    expect(parseMarks('2')).toBe(2);
    expect(parseMarks(' 1.5 ')).toBe(1.5);
    expect(parseMarks('0.5')).toBe(0.5);
  });

  it('rejects blanks, zero, negatives, other fractions and text', () => {
    for (const bad of ['', ' ', '0', '-1', '1.25', 'abc', 'Infinity']) {
      expect(parseMarks(bad)).toBeNull();
    }
  });
});

describe('draftTotal', () => {
  it('sums valid rows and ignores invalid ones', () => {
    const draft = {
      ...emptyDraft('code'),
      criteria: [
        { name: 'a', maxMarks: '2' },
        { name: 'b', maxMarks: '0.5' },
        { name: 'c', maxMarks: 'x' },
      ],
    };
    expect(draftTotal(draft)).toBe(2.5);
  });
});

describe('draftToBody', () => {
  const filled = {
    ...emptyDraft('code'),
    body: 'Reverse a string',
    criteria: [
      { name: 'Correct', maxMarks: '2' },
      { name: '', maxMarks: '' },
    ],
  };

  it('drops fully blank criteria rows', () => {
    const result = draftToBody(filled);
    expect('body' in result && result.body.criteria).toEqual([{ name: 'Correct', maxMarks: 2 }]);
  });

  it('reports a half-filled or bad row', () => {
    const bad = { ...filled, criteria: [{ name: 'Correct', maxMarks: '1.3' }] };
    expect(draftToBody(bad)).toEqual({
      error: 'Criterion 1 needs a name and marks in steps of 0.5',
    });
  });

  it('clears languages for a written question and rejects an empty statement', () => {
    const written = { ...filled, type: 'written' as const, sampleLanguage: 'text' };
    const result = draftToBody(written);
    expect('body' in result && result.body.allowedLanguages).toEqual([]);
    expect('error' in draftToBody({ ...filled, body: ' ' })).toBe(true);
  });

  it('allows an unfinished draft (no criteria, no sample answer)', () => {
    expect('body' in draftToBody({ ...filled, criteria: [] })).toBe(true);
  });
});

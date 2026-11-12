import { describe, expect, it } from 'vitest';
import { isTimeUp, submitRefusalText } from './submit';

describe('isTimeUp', () => {
  it('is false before the deadline and true at and after it, using the server clock', () => {
    expect(isTimeUp(10_000, 9_000, 0)).toBe(false);
    expect(isTimeUp(10_000, 10_000, 0)).toBe(true);
    expect(isTimeUp(10_000, 11_000, 0)).toBe(true);
    // The server is 2 s ahead of this PC, so the deadline arrives 2 s earlier here.
    expect(isTimeUp(10_000, 8_500, 2_000)).toBe(true);
    expect(isTimeUp(10_000, 7_500, 2_000)).toBe(false);
  });
});

describe('submitRefusalText', () => {
  it('has a sentence for each reason and for an unknown one', () => {
    const texts = ['not_running', 'not_working', 'stopped', 'other'].map(submitRefusalText);
    expect(new Set(texts).size).toBe(4);
    for (const text of texts) expect(text.length).toBeGreaterThan(10);
  });
});

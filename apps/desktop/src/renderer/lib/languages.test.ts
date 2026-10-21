import { describe, expect, it } from 'vitest';
import { LANGUAGE_LABEL, pickLanguage } from './languages';

describe('pickLanguage', () => {
  it('keeps the current language when it is allowed', () => {
    expect(pickLanguage(['c', 'js'], 'js')).toBe('js');
  });

  it('falls back to the first allowed language', () => {
    expect(pickLanguage(['c', 'js'], undefined)).toBe('c');
    expect(pickLanguage(['c', 'js'], 'cpp')).toBe('c');
  });

  it('returns undefined when nothing is allowed', () => {
    expect(pickLanguage([], 'c')).toBeUndefined();
  });

  it('labels C++ readably', () => {
    expect(LANGUAGE_LABEL.cpp).toBe('C++');
  });
});

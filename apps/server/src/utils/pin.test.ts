import { describe, expect, it } from 'vitest';
import { generatePin } from './pin.js';

describe('generatePin', () => {
  it('is always 6 digits', () => {
    for (let i = 0; i < 500; i++) expect(generatePin()).toMatch(/^\d{6}$/);
  });
});

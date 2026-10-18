import { describe, expect, it } from 'vitest';
import { restartDelayMs } from './server-backoff.js';

describe('restartDelayMs', () => {
  it('follows 1 s, 2 s, 5 s then 10 s forever', () => {
    expect([0, 1, 2, 3, 4, 50].map(restartDelayMs)).toEqual([
      1000, 2000, 5000, 10_000, 10_000, 10_000,
    ]);
  });

  it('treats a negative attempt as the first', () => {
    expect(restartDelayMs(-3)).toBe(1000);
  });
});

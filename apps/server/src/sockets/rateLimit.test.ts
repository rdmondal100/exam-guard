import { describe, expect, it } from 'vitest';
import { TokenBucket } from './rateLimit.js';

describe('TokenBucket', () => {
  it('allows a burst, then refills over time', () => {
    let t = 0;
    const bucket = new TokenBucket(2, 3, () => t);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    t = 500; // half a second at 2/s = one token
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    t = 100_000; // never more than the burst
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

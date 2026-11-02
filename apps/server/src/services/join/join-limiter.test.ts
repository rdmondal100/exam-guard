import { describe, expect, it } from 'vitest';
import { JoinLimiter } from './join-limiter.js';

describe('JoinLimiter', () => {
  it('locks an IP after 5 failures and frees it once the window passes', () => {
    let now = 0;
    const limiter = new JoinLimiter(() => now);
    for (let i = 0; i < 4; i++) limiter.recordFailure('a');
    expect(limiter.retryAfterSec('a')).toBe(0);
    limiter.recordFailure('a');
    expect(limiter.retryAfterSec('a')).toBe(60);
    now = 45_000;
    expect(limiter.retryAfterSec('a')).toBe(15);
    now = 60_001;
    expect(limiter.retryAfterSec('a')).toBe(0);
  });

  it('is per IP and a success clears the count', () => {
    const limiter = new JoinLimiter(() => 0);
    for (let i = 0; i < 5; i++) limiter.recordFailure('a');
    expect(limiter.retryAfterSec('b')).toBe(0);
    limiter.recordSuccess('a');
    expect(limiter.retryAfterSec('a')).toBe(0);
  });
});

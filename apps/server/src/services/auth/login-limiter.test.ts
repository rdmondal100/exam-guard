import { describe, expect, it } from 'vitest';
import { LoginLimiter } from './login-limiter.js';

function setup() {
  let t = 1_000_000;
  const limiter = new LoginLimiter(() => t);
  return {
    limiter,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function fail(limiter: LoginLimiter, times: number) {
  for (let i = 0; i < times; i++) limiter.recordFailure();
}

describe('LoginLimiter', () => {
  it('allows four failures and locks on the fifth', () => {
    const { limiter } = setup();
    fail(limiter, 4);
    expect(limiter.retryAfterSec()).toBe(0);
    fail(limiter, 1);
    expect(limiter.retryAfterSec()).toBe(30);
  });

  it('unlocks after the delay and doubles the next lockout', () => {
    const { limiter, advance } = setup();
    fail(limiter, 5);
    advance(30_000);
    expect(limiter.retryAfterSec()).toBe(0);
    fail(limiter, 5);
    expect(limiter.retryAfterSec()).toBe(60);
  });

  it('caps the lockout at five minutes', () => {
    const { limiter, advance } = setup();
    for (let round = 0; round < 8; round++) {
      fail(limiter, 5);
      advance(10 * 60_000);
    }
    fail(limiter, 5);
    expect(limiter.retryAfterSec()).toBe(300);
  });

  it('a success resets the counters', () => {
    const { limiter } = setup();
    fail(limiter, 4);
    limiter.recordSuccess();
    fail(limiter, 1);
    expect(limiter.retryAfterSec()).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { formatRemaining, remainingMs } from './examClock';

describe('remainingMs', () => {
  it('counts down to the deadline', () => {
    expect(remainingMs(10_000, 4_000, 0)).toBe(6_000);
  });

  it('uses the server offset: a client clock 5 s behind sees the same time left', () => {
    // Server now = 14 000, local now = 9 000, so the offset is +5 000.
    expect(remainingMs(20_000, 9_000, 5_000)).toBe(6_000);
  });

  it('assumes matching clocks before the first pong', () => {
    expect(remainingMs(10_000, 4_000, null)).toBe(6_000);
  });

  it('never goes below zero', () => {
    expect(remainingMs(10_000, 12_000, 0)).toBe(0);
  });
});

describe('formatRemaining', () => {
  it('formats minutes and seconds', () => {
    expect(formatRemaining(65_000)).toBe('1:05');
    expect(formatRemaining(9_000)).toBe('0:09');
  });

  it('adds hours from one hour up', () => {
    expect(formatRemaining(3_600_000)).toBe('1:00:00');
    expect(formatRemaining(3_725_000)).toBe('1:02:05');
  });

  it('rounds partial seconds up and clamps negatives', () => {
    expect(formatRemaining(1)).toBe('0:01');
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(-500)).toBe('0:00');
  });
});

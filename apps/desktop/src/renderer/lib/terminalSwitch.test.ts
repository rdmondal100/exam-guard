import { describe, expect, it } from 'vitest';
import { formatRemaining, parseMinutes, terminalLabel } from './terminalSwitch';

describe('formatRemaining', () => {
  it.each([
    [0, '0:00'],
    [-5000, '0:00'],
    [1, '0:01'],
    [112_000, '1:52'],
    [3_600_000, '1:00:00'],
    [3_725_000, '1:02:05'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatRemaining(ms)).toBe(text);
  });
});

describe('terminalLabel', () => {
  it('describes off, on, pending and timed windows', () => {
    expect(terminalLabel({ enabled: false, until: null }, null, 0)).toBe('Off');
    expect(terminalLabel({ enabled: true, until: null }, null, 0)).toBe('On');
    expect(terminalLabel({ enabled: true, until: null }, 30, 0)).toBe(
      'On for 30 min, counted from Start',
    );
    expect(terminalLabel({ enabled: true, until: 120_000 }, null, 8_000)).toBe(
      'On · turns off in 1:52',
    );
  });
});

describe('parseMinutes', () => {
  it('accepts whole minutes from 1 to 600', () => {
    expect(parseMinutes(' 30 ')).toBe(30);
    expect(parseMinutes('600')).toBe(600);
    for (const bad of ['', '0', '601', '1.5', '-2', 'ten']) expect(parseMinutes(bad)).toBeNull();
  });
});

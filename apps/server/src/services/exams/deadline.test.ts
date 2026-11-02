import { describe, expect, it } from 'vitest';
import { computeDeadline } from './deadline.js';

const base = {
  startedAt: 1_000_000,
  durationSec: 3600,
  globalExtensionSec: 0,
  studentExtensionSec: 0,
};

describe('computeDeadline', () => {
  it('is start plus duration', () => {
    expect(computeDeadline(base)).toBe(1_000_000 + 3_600_000);
  });

  it('adds the global and the personal extension', () => {
    expect(computeDeadline({ ...base, globalExtensionSec: 300, studentExtensionSec: 60 })).toBe(
      1_000_000 + 3_960_000,
    );
  });

  it('does not depend on when a student joined', () => {
    // Nothing but the exam start goes in, so a late joiner gets the same end.
    expect(computeDeadline(base)).toBe(computeDeadline({ ...base }));
  });
});

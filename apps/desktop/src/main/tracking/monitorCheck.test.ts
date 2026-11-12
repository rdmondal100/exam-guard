import { describe, expect, it } from 'vitest';
import type { FrontWindow } from './foreground.js';
import { checkMonitor } from './monitorCheck.js';

const front: FrontWindow = {
  exe: 'ExamGuard.exe',
  path: 'C:\\EG\\ExamGuard.exe',
  pid: 1,
  windowId: 2,
  title: 'ExamGuard',
};

describe('checkMonitor', () => {
  it('passes with a picture, a screen and a readable window', async () => {
    const status = await checkMonitor({
      capture: async () => new Uint8Array([1, 2]),
      readFront: async () => front,
      screens: () => 2,
      retryMs: 0,
    });
    expect(status).toEqual({ ok: true, captureOk: true, monitors: 2 });
  });

  it('retries the window a few times before it gives up', async () => {
    let reads = 0;
    const flaky = await checkMonitor({
      capture: async () => new Uint8Array([1]),
      readFront: async () => (++reads === 2 ? front : null),
      screens: () => 1,
      retryMs: 0,
    });
    expect(flaky.ok).toBe(true);
    reads = 0;
    const never = await checkMonitor({
      capture: async () => new Uint8Array([1]),
      readFront: async () => {
        reads += 1;
        return null;
      },
      screens: () => 1,
      retryMs: 0,
    });
    expect(never.ok).toBe(false);
    expect(reads).toBe(3);
  });

  it('fails the capture on no picture or an error', async () => {
    const empty = await checkMonitor({
      capture: async () => null,
      readFront: async () => front,
      screens: () => 1,
      retryMs: 0,
    });
    expect(empty.captureOk).toBe(false);
    const broken = await checkMonitor({
      capture: () => Promise.reject(new Error('no access')),
      readFront: async () => front,
      screens: () => 0,
      retryMs: 0,
    });
    expect(broken).toEqual({ ok: true, captureOk: false, monitors: 0 });
  });
});

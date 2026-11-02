import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThumbCapture } from './thumb-capture.js';

const START = { t: 'thumb.start', intervalMs: 4000, width: 320 } as const;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff]);

function setup(capture: (width: number) => Promise<Uint8Array | null> = async () => JPEG) {
  const sent: number[] = [];
  const widths: number[] = [];
  const thumbs = new ThumbCapture({
    capture: (width) => {
      widths.push(width);
      return capture(width);
    },
    send: (_jpeg, at) => sent.push(at),
    now: () => 7,
  });
  return { thumbs, sent, widths };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ThumbCapture', () => {
  it('captures at once and then every interval while asked and monitoring', async () => {
    const { thumbs, sent, widths } = setup();
    thumbs.setCommand(START);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toEqual([]);
    thumbs.setMonitoring(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([7]);
    await vi.advanceTimersByTimeAsync(8000);
    expect(sent).toHaveLength(3);
    expect(widths.every((w) => w === 320)).toBe(true);
  });

  it('stops on thumb.stop, a closed socket or the end of monitoring', async () => {
    const { thumbs, sent } = setup();
    thumbs.setMonitoring(true);
    thumbs.setCommand(START);
    await vi.advanceTimersByTimeAsync(0);
    thumbs.setCommand(null);
    expect(thumbs.running).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent).toHaveLength(1);
    thumbs.setCommand(START);
    thumbs.setMonitoring(false);
    expect(thumbs.running).toBe(false);
  });

  it('keeps its rhythm when the same start arrives again', async () => {
    const { thumbs, sent } = setup();
    thumbs.setMonitoring(true);
    thumbs.setCommand(START);
    await vi.advanceTimersByTimeAsync(2000);
    thumbs.setCommand({ ...START });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
  });

  it('never overlaps captures and sends nothing for a failed one', async () => {
    let release: (value: Uint8Array | null) => void = () => {};
    let calls = 0;
    const { thumbs, sent } = setup(() => {
      calls += 1;
      return new Promise((resolve) => (release = resolve));
    });
    thumbs.setMonitoring(true);
    thumbs.setCommand(START);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(calls).toBe(1);
    release(null);
    await vi.advanceTimersByTimeAsync(4000);
    expect(sent).toEqual([]);
    expect(calls).toBe(2);
  });

  it('drops a picture that finishes after the page changed', async () => {
    let release: (value: Uint8Array | null) => void = () => {};
    const { thumbs, sent } = setup(() => new Promise((resolve) => (release = resolve)));
    thumbs.setMonitoring(true);
    thumbs.setCommand(START);
    thumbs.setCommand(null);
    release(JPEG);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([]);
  });
});

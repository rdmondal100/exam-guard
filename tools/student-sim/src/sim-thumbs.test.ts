import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { StudentThumbHeaderSchema, decodeThumbFrame } from '@examguard/shared';
import { SIM_THUMB_BYTES, SimThumbs, syntheticJpeg } from './sim-thumbs.js';

describe('syntheticJpeg', () => {
  it('is a JPEG of about 15 KB that still starts and ends like one', () => {
    const jpeg = syntheticJpeg();
    expect(jpeg.length).toBe(SIM_THUMB_BYTES);
    expect([jpeg[0], jpeg[1], jpeg[2], jpeg[3]]).toEqual([0xff, 0xd8, 0xff, 0xfe]);
    expect([jpeg.at(-2), jpeg.at(-1)]).toEqual([0xff, 0xd9]);
    // The comment segment's length covers the padding exactly; the sample's own segments follow.
    const length = ((jpeg[4] ?? 0) << 8) | (jpeg[5] ?? 0);
    expect(jpeg[4 + length]).toBe(0xff);
  });
});

describe('SimThumbs', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends a frame at once and every interval until stopped', () => {
    const frames: Uint8Array[] = [];
    const ws = {
      readyState: WebSocket.OPEN,
      send: (frame: Uint8Array) => frames.push(frame),
    } as unknown as WebSocket;
    const thumbs = new SimThumbs(3);
    thumbs.start(ws, 4000);
    vi.advanceTimersByTime(8000);
    thumbs.stop();
    vi.advanceTimersByTime(8000);
    expect(frames).toHaveLength(3);
    const decoded = decodeThumbFrame(frames[0] ?? new Uint8Array(), StudentThumbHeaderSchema);
    expect(decoded?.jpeg.length).toBe(SIM_THUMB_BYTES);
    expect(thumbs.totals()).toMatchObject({ starts: 1, sent: 3 });
    expect(thumbs.streaming).toBe(false);
  });

  it('stops by itself once the socket is closed', () => {
    const ws = { readyState: WebSocket.CLOSED, send: vi.fn() } as unknown as WebSocket;
    const thumbs = new SimThumbs(0);
    thumbs.start(ws, 4000);
    expect(thumbs.streaming).toBe(false);
  });
});

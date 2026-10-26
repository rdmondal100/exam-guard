import { describe, expect, it } from 'vitest';
import {
  BINARY_KIND_SCREENSHOT,
  SCREENSHOT_CHUNK_BYTES,
  decodeScreenshotFrame,
  encodeScreenshotFrames,
} from './screenshot-frame.js';

function jpegOf(size: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_, i) => i % 251);
}

describe('screenshot frames', () => {
  it('sends a small picture as one frame that decodes to the same bytes', () => {
    const jpeg = jpegOf(1000);
    const frames = encodeScreenshotFrames('dev:1', jpeg);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.[0]).toBe(BINARY_KIND_SCREENSHOT);
    const chunk = decodeScreenshotFrame(frames[0] ?? new Uint8Array());
    expect(chunk?.header).toEqual({ ref: 'dev:1', index: 0, total: 1 });
    expect(Array.from(chunk?.payload ?? [])).toEqual(Array.from(jpeg));
  });

  it('cuts a larger picture into ordered chunks that join back together', () => {
    const jpeg = jpegOf(SCREENSHOT_CHUNK_BYTES * 2 + 5);
    const frames = encodeScreenshotFrames('r', jpeg);
    expect(frames).toHaveLength(3);
    const parts = frames.map((frame) => decodeScreenshotFrame(frame));
    expect(parts.map((part) => part?.header.index)).toEqual([0, 1, 2]);
    expect(parts.every((part) => part?.header.total === 3)).toBe(true);
    const joined = parts.flatMap((part) => Array.from(part?.payload ?? []));
    expect(joined).toEqual(Array.from(jpeg));
  });

  it('refuses a frame of another kind, a cut-off header and a bad header', () => {
    const [frame = new Uint8Array()] = encodeScreenshotFrames('r', jpegOf(10));
    expect(decodeScreenshotFrame(Uint8Array.from([1, ...frame.subarray(1)]))).toBeNull();
    expect(decodeScreenshotFrame(frame.subarray(0, 6))).toBeNull();
    expect(decodeScreenshotFrame(new Uint8Array([2, 0, 0]))).toBeNull();
    const bad = Array.from('{"ref":"r","index":3,"total":2}', (char) => char.charCodeAt(0));
    const framed = new Uint8Array([2, 0, bad.length, ...bad]);
    expect(decodeScreenshotFrame(framed)).toBeNull();
  });
});

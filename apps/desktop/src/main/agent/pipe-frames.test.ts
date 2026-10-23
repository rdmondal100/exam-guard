import { describe, expect, it } from 'vitest';
import { MAX_PIPE_FRAME_BYTES } from '@examguard/shared';
import { encodeFrame, FrameDecoder } from './pipe-frames.js';

describe('pipe frames', () => {
  it('round-trips a message with a 4-byte little-endian length', () => {
    const frame = encodeFrame({ t: 'hello', n: 'é' });
    expect(frame.readUInt32LE(0)).toBe(frame.length - 4);
    expect(new FrameDecoder().push(frame)).toEqual([{ t: 'hello', n: 'é' }]);
  });

  it('rebuilds a message split over reads and splits two glued together', () => {
    const wire = Buffer.concat([encodeFrame({ a: 1 }), encodeFrame({ b: 2 })]);
    const decoder = new FrameDecoder();
    const out: unknown[] = [];
    for (let i = 0; i < wire.length; i += 3) out.push(...decoder.push(wire.subarray(i, i + 3)));
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
    expect(new FrameDecoder().push(wire)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('gives undefined for text that is not JSON and carries on', () => {
    const bad = Buffer.from('nope');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(bad.length, 0);
    const out = new FrameDecoder().push(Buffer.concat([header, bad, encodeFrame({ ok: true })]));
    expect(out).toEqual([undefined, { ok: true }]);
  });

  it('refuses an oversized length before its payload arrives', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(MAX_PIPE_FRAME_BYTES + 1, 0);
    expect(() => new FrameDecoder().push(header)).toThrow(/too large/);
  });
});

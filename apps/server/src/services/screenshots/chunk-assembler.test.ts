import { describe, expect, it } from 'vitest';
import { SCREENSHOT_CHUNK_BYTES, encodeScreenshotFrames } from '@examguard/shared';
import { ChunkAssembler, looksLikeJpeg } from './chunk-assembler.js';

const jpeg = (size: number): Uint8Array => {
  const bytes = new Uint8Array(size).fill(9);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  return bytes;
};

describe('looksLikeJpeg', () => {
  it('accepts the JPEG start marker and nothing else', () => {
    expect(looksLikeJpeg(jpeg(10))).toBe(true);
    expect(looksLikeJpeg(new Uint8Array([1, 2, 3, 4, 5, 6]))).toBe(false);
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
  });
});

describe('ChunkAssembler', () => {
  it('joins the pieces of one picture in order, whatever order they come in', () => {
    const assembler = new ChunkAssembler();
    const picture = jpeg(SCREENSHOT_CHUNK_BYTES * 2 + 7);
    const frames = encodeScreenshotFrames('r1', picture);
    for (const frame of [frames[2], frames[0], frames[1]]) {
      expect(assembler.add('s1', frame ?? new Uint8Array())).toBe(true);
    }
    expect(Array.from(assembler.take('s1', 'r1') ?? [])).toEqual(Array.from(picture));
  });

  it('gives nothing while a piece is missing, and does not revive the picture later', () => {
    const assembler = new ChunkAssembler();
    const frames = encodeScreenshotFrames('r1', jpeg(SCREENSHOT_CHUNK_BYTES + 10));
    assembler.add('s1', frames[0] ?? new Uint8Array());
    expect(assembler.take('s1', 'r1')).toBeNull();
    assembler.add('s1', frames[1] ?? new Uint8Array());
    expect(assembler.take('s1', 'r1')).toBeNull();
  });

  it('keeps each student apart and refuses frames that are not chunks', () => {
    const assembler = new ChunkAssembler();
    const [frame = new Uint8Array()] = encodeScreenshotFrames('r1', jpeg(50));
    assembler.add('s1', frame);
    expect(assembler.take('s2', 'r1')).toBeNull();
    expect(assembler.take('s1', 'r1')).not.toBeNull();
    expect(assembler.add('s1', new Uint8Array([2, 0, 0]))).toBe(false);
  });

  it('refuses bytes that are not a JPEG', () => {
    const assembler = new ChunkAssembler();
    const [frame = new Uint8Array()] = encodeScreenshotFrames('r1', new Uint8Array(40).fill(1));
    assembler.add('s1', frame);
    expect(assembler.take('s1', 'r1')).toBeNull();
  });

  it('drops the oldest half-sent picture past the per-student limit', () => {
    const assembler = new ChunkAssembler();
    for (let i = 0; i < 8; i += 1) {
      const frames = encodeScreenshotFrames(`r${i}`, jpeg(SCREENSHOT_CHUNK_BYTES + 10));
      assembler.add('s1', frames[0] ?? new Uint8Array());
    }
    // r0 was pushed out: its second piece alone cannot complete it.
    const late = encodeScreenshotFrames('r0', jpeg(SCREENSHOT_CHUNK_BYTES + 10));
    assembler.add('s1', late[1] ?? new Uint8Array());
    expect(assembler.take('s1', 'r0')).toBeNull();
  });

  it('forget() drops everything of a student', () => {
    const assembler = new ChunkAssembler();
    const [frame = new Uint8Array()] = encodeScreenshotFrames('r1', jpeg(50));
    assembler.add('s1', frame);
    assembler.forget('s1');
    expect(assembler.take('s1', 'r1')).toBeNull();
  });
});

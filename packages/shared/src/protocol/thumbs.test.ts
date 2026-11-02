import { describe, expect, it } from 'vitest';
import {
  BINARY_KIND_THUMB,
  MAX_THUMB_BYTES,
  StudentThumbHeaderSchema,
  TeacherThumbHeaderSchema,
  ThumbsSubscribeSchema,
  decodeThumbFrame,
  encodeThumbFrame,
} from './thumbs.js';
import { ServerToStudentSchema, TeacherMessageSchema } from './ws.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('thumbnail frames', () => {
  it('round-trips a teacher frame', () => {
    const frame = encodeThumbFrame({ examStudentId: 's1', ts: 42 }, JPEG);
    expect(frame[0]).toBe(BINARY_KIND_THUMB);
    const decoded = decodeThumbFrame(frame, TeacherThumbHeaderSchema);
    expect(decoded?.header).toEqual({ examStudentId: 's1', ts: 42 });
    expect(Array.from(decoded?.jpeg ?? [])).toEqual(Array.from(JPEG));
  });

  it('refuses a wrong kind, a bad header, an empty or oversized picture', () => {
    const ok = encodeThumbFrame({ ts: 1 }, JPEG);
    const wrongKind = ok.slice();
    wrongKind[0] = 2;
    expect(decodeThumbFrame(wrongKind, StudentThumbHeaderSchema)).toBeNull();
    expect(decodeThumbFrame(ok, TeacherThumbHeaderSchema)).toBeNull();
    expect(
      decodeThumbFrame(encodeThumbFrame({ ts: 1 }, new Uint8Array()), StudentThumbHeaderSchema),
    ).toBeNull();
    const big = encodeThumbFrame({ ts: 1 }, new Uint8Array(MAX_THUMB_BYTES + 1));
    expect(decodeThumbFrame(big, StudentThumbHeaderSchema)).toBeNull();
    expect(decodeThumbFrame(new Uint8Array([1, 0, 50, 1]), StudentThumbHeaderSchema)).toBeNull();
  });

  it('parses the thumbnail messages in the socket unions', () => {
    expect(
      ServerToStudentSchema.safeParse({ t: 'thumb.start', intervalMs: 4000, width: 320 }).success,
    ).toBe(true);
    expect(ServerToStudentSchema.safeParse({ t: 'thumb.stop' }).success).toBe(true);
    expect(
      TeacherMessageSchema.safeParse({ t: 'thumbs.subscribe', examStudentIds: ['a', 'b'] }).success,
    ).toBe(true);
    const tooMany = Array.from({ length: 201 }, (_, i) => `s${i}`);
    expect(
      ThumbsSubscribeSchema.safeParse({ t: 'thumbs.subscribe', examStudentIds: tooMany }).success,
    ).toBe(false);
  });
});

describe('fast thumbnail focus (M34 fallback)', () => {
  it('accepts up to two students and an empty list', () => {
    const ok = (ids: string[]) =>
      TeacherMessageSchema.safeParse({ t: 'thumbs.focus', examStudentIds: ids }).success;
    expect(ok([])).toBe(true);
    expect(ok(['a', 'b'])).toBe(true);
    expect(ok(['a', 'b', 'c'])).toBe(false);
    expect(ok([''])).toBe(false);
  });
});

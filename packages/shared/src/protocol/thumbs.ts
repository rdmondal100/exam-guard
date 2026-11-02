import { z } from 'zod';

// This package builds without DOM or Node typings; both runtimes that use it provide these globals.
declare const TextEncoder: new () => { encode(input: string): Uint8Array };
declare const TextDecoder: new () => { decode(input: Uint8Array): string };

/**
 * Thumbnail grid (M29, M33; docs/architecture.md §5): the teacher names the students on the
 * visible page, the server asks only those to stream a small JPEG of their screen, keeps the latest
 * frame per student in memory and forwards it. Nothing is stored.
 */
export const BINARY_KIND_THUMB = 1;
/** How often a visible student sends a frame. */
export const THUMB_INTERVAL_MS = 4000;
/** Width of a grid thumbnail, in pixels. */
export const THUMB_WIDTH = 320;
/** Largest thumbnail the server forwards (a 320 px JPEG is about 10–20 KB). */
export const MAX_THUMB_BYTES = 256 * 1024;
/** Most students one teacher socket may watch at once (a page is 25–30). */
export const MAX_THUMB_WATCH = 200;

// ---- server → student ----

export const ThumbStartSchema = z.object({
  t: z.literal('thumb.start'),
  intervalMs: z.number().int().min(250).max(60_000),
  width: z.number().int().min(64).max(1920),
});
export type ThumbStart = z.infer<typeof ThumbStartSchema>;

export const ThumbStopSchema = z.object({ t: z.literal('thumb.stop') });
export type ThumbStop = z.infer<typeof ThumbStopSchema>;

// ---- teacher → server ----

/** The students on the visible grid page; replaces the previous list. `[]` stops every stream. */
export const ThumbsSubscribeSchema = z.object({
  t: z.literal('thumbs.subscribe'),
  examStudentIds: z.array(z.string().min(1).max(100)).max(MAX_THUMB_WATCH),
});
export type ThumbsSubscribe = z.infer<typeof ThumbsSubscribeSchema>;

// ---- binary frames ----

/** Header of a student → server thumbnail frame: when the student captured it (its clock). */
export const StudentThumbHeaderSchema = z.object({ ts: z.number() });
export type StudentThumbHeader = z.infer<typeof StudentThumbHeaderSchema>;

/** Header of a server → teacher thumbnail frame: whose screen, and when the server got it. */
export const TeacherThumbHeaderSchema = z.object({
  examStudentId: z.string().min(1).max(100),
  ts: z.number(),
});
export type TeacherThumbHeader = z.infer<typeof TeacherThumbHeaderSchema>;

/** `[u8 kind=1][u16 BE headerLen][header JSON][JPEG]` (docs/protocol.md §3). */
export function encodeThumbFrame(
  header: StudentThumbHeader | TeacherThumbHeader,
  jpeg: Uint8Array,
): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(header));
  const frame = new Uint8Array(3 + head.length + jpeg.length);
  frame[0] = BINARY_KIND_THUMB;
  frame[1] = (head.length >> 8) & 0xff;
  frame[2] = head.length & 0xff;
  frame.set(head, 3);
  frame.set(jpeg, 3 + head.length);
  return frame;
}

/** `null` for a frame that is not a well-formed thumbnail with this header shape. */
export function decodeThumbFrame<T>(
  frame: Uint8Array,
  schema: z.ZodType<T>,
): { header: T; jpeg: Uint8Array } | null {
  if (frame.length < 3 || frame[0] !== BINARY_KIND_THUMB) return null;
  const headerLength = ((frame[1] ?? 0) << 8) | (frame[2] ?? 0);
  if (headerLength === 0 || 3 + headerLength > frame.length) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(frame.subarray(3, 3 + headerLength)));
  } catch {
    return null;
  }
  const header = schema.safeParse(raw);
  if (!header.success) return null;
  const jpeg = frame.subarray(3 + headerLength);
  if (jpeg.length === 0 || jpeg.length > MAX_THUMB_BYTES) return null;
  return { header: header.data, jpeg };
}

/** `GET /thumbs/stats`: what the relay did since hosting started, to check that only the visible stream. */
export const ThumbStatsSchema = z.object({
  /** Students told to stream right now. */
  streaming: z.number().int().nonnegative(),
  /** Teacher sockets watching a page. */
  viewers: z.number().int().nonnegative(),
  /** Latest frames held in memory. */
  cached: z.number().int().nonnegative(),
  framesIn: z.number().int().nonnegative(),
  bytesIn: z.number().int().nonnegative(),
  framesOut: z.number().int().nonnegative(),
  bytesOut: z.number().int().nonnegative(),
  /** Frames refused: malformed, not a JPEG, or from a student nobody watches. */
  dropped: z.number().int().nonnegative(),
  /** Server time the counters started. */
  since: z.number(),
});
export type ThumbStats = z.infer<typeof ThumbStatsSchema>;

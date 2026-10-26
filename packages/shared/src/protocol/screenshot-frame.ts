import { z } from 'zod';

// This package builds without DOM or Node typings; both runtimes that use it provide these globals.
declare const TextEncoder: new () => { encode(input: string): Uint8Array };
declare const TextDecoder: new () => { decode(input: Uint8Array): string };

/** Binary student → server frame: `[u8 kind][u16 BE headerLen][header JSON][payload]` (docs/protocol.md §3). */
export const BINARY_KIND_SCREENSHOT = 2;
/** Payload size of one screenshot chunk, well under the 512 KB frame limit. */
export const SCREENSHOT_CHUNK_BYTES = 200 * 1024;
/** Largest screenshot the server keeps. */
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
export const MAX_SCREENSHOT_CHUNKS = Math.ceil(MAX_SCREENSHOT_BYTES / SCREENSHOT_CHUNK_BYTES);

export const ScreenshotChunkHeaderSchema = z.object({
  /** Matches the `screenshotRef` of the `event` this picture belongs to. */
  ref: z.string().min(1).max(100),
  index: z
    .number()
    .int()
    .min(0)
    .max(MAX_SCREENSHOT_CHUNKS - 1),
  total: z.number().int().min(1).max(MAX_SCREENSHOT_CHUNKS),
});
export type ScreenshotChunkHeader = z.infer<typeof ScreenshotChunkHeaderSchema>;

export interface ScreenshotChunk {
  header: ScreenshotChunkHeader;
  payload: Uint8Array;
}

/** Cuts a JPEG into frames, in order. */
export function encodeScreenshotFrames(ref: string, jpeg: Uint8Array): Uint8Array[] {
  const total = Math.max(1, Math.ceil(jpeg.length / SCREENSHOT_CHUNK_BYTES));
  const frames: Uint8Array[] = [];
  for (let index = 0; index < total; index += 1) {
    const payload = jpeg.subarray(
      index * SCREENSHOT_CHUNK_BYTES,
      (index + 1) * SCREENSHOT_CHUNK_BYTES,
    );
    const header = new TextEncoder().encode(JSON.stringify({ ref, index, total }));
    const frame = new Uint8Array(3 + header.length + payload.length);
    frame[0] = BINARY_KIND_SCREENSHOT;
    frame[1] = (header.length >> 8) & 0xff;
    frame[2] = header.length & 0xff;
    frame.set(header, 3);
    frame.set(payload, 3 + header.length);
    frames.push(frame);
  }
  return frames;
}

/** `null` for a frame that is not a well-formed screenshot chunk. */
export function decodeScreenshotFrame(frame: Uint8Array): ScreenshotChunk | null {
  if (frame.length < 3 || frame[0] !== BINARY_KIND_SCREENSHOT) return null;
  const headerLength = ((frame[1] ?? 0) << 8) | (frame[2] ?? 0);
  if (headerLength === 0 || 3 + headerLength > frame.length) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(frame.subarray(3, 3 + headerLength)));
  } catch {
    return null;
  }
  const header = ScreenshotChunkHeaderSchema.safeParse(raw);
  if (!header.success || header.data.index >= header.data.total) return null;
  return { header: header.data, payload: frame.subarray(3 + headerLength) };
}

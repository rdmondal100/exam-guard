import { MAX_PIPE_FRAME_BYTES } from '@examguard/shared';

/** One pipe message: a `u32` little-endian length, then UTF-8 JSON (docs/protocol.md §4). */
export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_PIPE_FRAME_BYTES) throw new RangeError('pipe frame too large');
  const frame = Buffer.alloc(4 + body.length);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

/**
 * Collects what arrives on the pipe and hands out the parsed messages. A message split over
 * several reads is rebuilt; a text that is not JSON comes out as `undefined` so the caller can
 * skip it; a length over the limit throws and the caller closes the pipe.
 */
export class FrameDecoder {
  private pending: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    const messages: unknown[] = [];
    while (this.pending.length >= 4) {
      const length = this.pending.readUInt32LE(0);
      if (length > MAX_PIPE_FRAME_BYTES) throw new RangeError('pipe frame too large');
      if (this.pending.length < 4 + length) break;
      const body = this.pending.subarray(4, 4 + length).toString('utf8');
      this.pending = this.pending.subarray(4 + length);
      messages.push(parseJson(body));
    }
    return messages;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

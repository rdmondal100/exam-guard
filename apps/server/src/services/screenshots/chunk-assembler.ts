import { MAX_SCREENSHOT_BYTES, decodeScreenshotFrame } from '@examguard/shared';

/** Pictures a student may have half-sent at once; the oldest is dropped past this. */
const MAX_OPEN_PER_STUDENT = 6;

interface Partial {
  total: number;
  parts: Map<number, Uint8Array>;
  bytes: number;
}

/** A JPEG starts with these two bytes. Anything else is not stored. */
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * Collects the binary screenshot chunks of each student until the event that names them arrives
 * (the client sends the chunks first on the same ordered socket).
 */
export class ChunkAssembler {
  private readonly open = new Map<string, Map<string, Partial>>();

  /** Keeps one chunk. Returns `false` for a frame that is not a valid chunk. */
  add(studentId: string, frame: Uint8Array): boolean {
    const chunk = decodeScreenshotFrame(frame);
    if (!chunk) return false;
    const { ref, index, total } = chunk.header;
    const pictures = this.open.get(studentId) ?? new Map<string, Partial>();
    this.open.set(studentId, pictures);
    let picture = pictures.get(ref);
    if (picture && picture.total !== total) {
      pictures.delete(ref);
      picture = undefined;
    }
    if (!picture) {
      picture = { total, parts: new Map(), bytes: 0 };
      pictures.set(ref, picture);
      if (pictures.size > MAX_OPEN_PER_STUDENT) {
        const oldest = pictures.keys().next().value;
        if (oldest !== undefined) pictures.delete(oldest);
      }
    }
    if (!picture.parts.has(index)) {
      picture.bytes += chunk.payload.length;
      picture.parts.set(index, chunk.payload.slice());
    }
    if (picture.bytes > MAX_SCREENSHOT_BYTES) {
      pictures.delete(ref);
      return false;
    }
    return true;
  }

  /** The finished picture for `ref`, or `null` if pieces are missing or it is not a JPEG. Forgets it. */
  take(studentId: string, ref: string): Uint8Array | null {
    const pictures = this.open.get(studentId);
    const picture = pictures?.get(ref);
    pictures?.delete(ref);
    if (!picture || picture.parts.size !== picture.total) return null;
    const whole = new Uint8Array(picture.bytes);
    let offset = 0;
    for (let index = 0; index < picture.total; index += 1) {
      const part = picture.parts.get(index);
      if (!part) return null;
      whole.set(part, offset);
      offset += part.length;
    }
    return looksLikeJpeg(whole) ? whole : null;
  }

  forget(studentId: string): void {
    this.open.delete(studentId);
  }
}

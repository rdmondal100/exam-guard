import WebSocket from 'ws';
import { encodeThumbFrame } from '@examguard/shared';
import { SAMPLE_THUMB_BASE64 } from './sample-thumb.js';

/** About what a real 320 px screen thumbnail weighs (docs/architecture.md §5). */
export const SIM_THUMB_BYTES = 15 * 1024;

/**
 * A displayable JPEG of `size` bytes: the sample picture with a comment segment (`FF FE`) right
 * after the start marker, filled with `seed` so each student's frames differ a little.
 */
export function syntheticJpeg(size = SIM_THUMB_BYTES, seed = 0): Uint8Array {
  const sample = Buffer.from(SAMPLE_THUMB_BASE64, 'base64');
  const pad = Math.max(0, Math.min(65_533, size - sample.length - 4));
  const out = new Uint8Array(sample.length + (pad > 0 ? pad + 4 : 0));
  out.set(sample.subarray(0, 2), 0);
  let at = 2;
  if (pad > 0) {
    const length = pad + 2;
    out.set([0xff, 0xfe, (length >> 8) & 0xff, length & 0xff], at);
    out.fill(seed & 0x7f, at + 4, at + 4 + pad);
    at += 4 + pad;
  }
  out.set(sample.subarray(2), at);
  return out;
}

export interface ThumbStats {
  /** `thumb.start` commands received. */
  starts: number;
  /** Frames sent. */
  sent: number;
  /** Bytes sent. */
  bytes: number;
}

/** A sim student's thumbnail stream: frames every `intervalMs` from `thumb.start` until `thumb.stop`. */
export class SimThumbs {
  private timer: NodeJS.Timeout | null = null;
  private readonly jpeg: Uint8Array;
  private stats: ThumbStats = { starts: 0, sent: 0, bytes: 0 };

  constructor(seed: number) {
    this.jpeg = syntheticJpeg(SIM_THUMB_BYTES, seed);
  }

  start(ws: WebSocket, intervalMs: number): void {
    this.stop();
    this.stats.starts += 1;
    const send = () => {
      if (ws.readyState !== WebSocket.OPEN) return this.stop();
      const frame = encodeThumbFrame({ ts: Date.now() }, this.jpeg);
      ws.send(frame, { binary: true });
      this.stats.sent += 1;
      this.stats.bytes += frame.length;
    };
    this.timer = setInterval(send, intervalMs);
    send();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get streaming(): boolean {
    return this.timer !== null;
  }

  totals(): ThumbStats {
    return { ...this.stats };
  }
}

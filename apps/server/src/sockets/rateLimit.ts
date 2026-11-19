/**
 * A token bucket per socket (M62). A frame over the limit is dropped without an ack, so the app
 * keeps it queued and sends it again after its next welcome: nothing is lost, a flood just waits.
 * The burst is large because a legitimate offline replay sends hundreds of frames at once.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly perSec: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.last = now();
  }

  /** Takes one token; `false` when the bucket is empty. */
  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.perSec);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Frames the student socket meters: monitor/app events, terminal transcripts, readiness. */
export const STUDENT_FRAME_LIMITS = {
  event: { perSec: 20, burst: 1000 },
  transcript: { perSec: 20, burst: 1000 },
  'readiness.report': { perSec: 0.2, burst: 5 },
} as const;

export type MeteredFrame = keyof typeof STUDENT_FRAME_LIMITS;

export function studentBuckets(now?: () => number): Record<MeteredFrame, TokenBucket> {
  const make = (k: MeteredFrame) =>
    new TokenBucket(STUDENT_FRAME_LIMITS[k].perSec, STUDENT_FRAME_LIMITS[k].burst, now);
  return {
    event: make('event'),
    transcript: make('transcript'),
    'readiness.report': make('readiness.report'),
  };
}

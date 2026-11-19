const MAX_FAILURES = 5;
const WINDOW_MS = 60_000;

/**
 * Per-IP limit on failed joins: 5 wrong PINs or unknown IDs per minute. Successful joins are
 * not counted, so a lab behind one address (or the student simulator) is not throttled.
 */
export class JoinLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Seconds the caller must wait, or 0 when a try is allowed. */
  retryAfterSec(ip: string): number {
    const recent = this.recent(ip);
    if (recent.length < MAX_FAILURES) return 0;
    const oldest = recent[0] ?? 0;
    return Math.max(1, Math.ceil((oldest + WINDOW_MS - this.now()) / 1000));
  }

  recordFailure(ip: string): void {
    this.failures.set(ip, [...this.recent(ip), this.now()]);
  }

  /**
   * A good join forgives one failure, not all: someone who knows the PIN could otherwise mix
   * good joins with guesses of class-list IDs and never be slowed down (M59).
   */
  recordSuccess(ip: string): void {
    const recent = this.recent(ip);
    if (recent.length <= 1) this.failures.delete(ip);
    else this.failures.set(ip, recent.slice(1));
  }

  private recent(ip: string): number[] {
    const cutoff = this.now() - WINDOW_MS;
    const recent = (this.failures.get(ip) ?? []).filter((t) => t > cutoff);
    if (recent.length === 0) this.failures.delete(ip);
    return recent;
  }
}

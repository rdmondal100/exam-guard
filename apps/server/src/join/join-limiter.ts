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

  recordSuccess(ip: string): void {
    this.failures.delete(ip);
  }

  private recent(ip: string): number[] {
    const cutoff = this.now() - WINDOW_MS;
    const recent = (this.failures.get(ip) ?? []).filter((t) => t > cutoff);
    if (recent.length === 0) this.failures.delete(ip);
    return recent;
  }
}

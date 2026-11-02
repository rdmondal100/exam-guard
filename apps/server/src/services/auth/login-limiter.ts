const MAX_FAILURES = 5;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 5 * 60_000;

/**
 * Counts failed logins. After 5 in a row the login is locked for 30 s, doubling on each
 * further lockout up to 5 min. A success resets everything. One instance covers the whole
 * loopback API (single teacher, so no per-IP bookkeeping).
 */
export class LoginLimiter {
  private failures = 0;
  private lockouts = 0;
  private lockedUntil = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Seconds the caller must wait, or 0 when a try is allowed. */
  retryAfterSec(): number {
    const remaining = this.lockedUntil - this.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures < MAX_FAILURES) return;
    this.failures = 0;
    const lock = Math.min(BASE_LOCK_MS * 2 ** this.lockouts, MAX_LOCK_MS);
    this.lockouts += 1;
    this.lockedUntil = this.now() + lock;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.lockouts = 0;
    this.lockedUntil = 0;
  }
}

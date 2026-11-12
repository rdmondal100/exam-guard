/** Restart delays after a server crash: 1 s, 2 s, 5 s, then every 10 s (architecture §1). */
const DELAYS_MS = [1000, 2000, 5000, 10_000];

/** A server that stayed up this long counts as healthy, so the schedule starts over. */
export const STABLE_UPTIME_MS = 30_000;

/** `attempt` is the number of consecutive failed starts so far, starting at 0. */
export function restartDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), DELAYS_MS.length - 1);
  return DELAYS_MS[index] ?? 10_000;
}

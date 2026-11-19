/**
 * Time left until the server deadline, in ms. `offsetMs` is the estimated server clock minus the
 * local clock (`null` before the first pong, when the best guess is that the clocks agree). While
 * the teacher has the exam paused (M58) the clock stands at what was left when the pause began.
 */
export function remainingMs(
  deadline: number,
  nowMs: number,
  offsetMs: number | null,
  pausedAt: number | null = null,
): number {
  if (pausedAt !== null) return Math.max(0, deadline - pausedAt);
  return Math.max(0, deadline - (nowMs + (offsetMs ?? 0)));
}

/** `H:MM:SS` from one hour up, otherwise `M:SS`. Rounds up so 0:00 only shows at the deadline. */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

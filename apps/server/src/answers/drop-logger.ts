/**
 * Logs dropped saves as a summary instead of one line each. The first drop after a quiet spell is
 * logged at once; drops in the next `intervalMs` are only counted and reported by the next drop
 * after that. Nothing runs on a timer, so there is nothing to clean up.
 */
export function createDropLogger(
  log: (line: string) => void,
  now: () => number,
  intervalMs = 5000,
): (reason: string) => void {
  const counts = new Map<string, number>();
  let lastLogged = Number.NEGATIVE_INFINITY;
  return (reason) => {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
    const time = now();
    if (time - lastLogged < intervalMs) return;
    lastLogged = time;
    const parts = [...counts].map(([r, n]) => `${r} x${n}`);
    counts.clear();
    log(`dropped saves: ${parts.join(', ')}`);
  };
}

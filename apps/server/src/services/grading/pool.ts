/**
 * Runs `work` over `items` with at most `concurrency` at once (the grading queue, architecture
 * §7). Stops taking new items once `signal` aborts; items already started finish or abort
 * themselves. Rejects with the first error `work` throws, after the running items settle.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | null = null;
  const worker = async () => {
    while (!failure && !signal?.aborted && next < items.length) {
      const item = items[next] as T;
      next += 1;
      try {
        await work(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker);
  await Promise.all(workers);
  if (failure) throw (failure as { error: unknown }).error;
}

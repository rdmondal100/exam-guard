export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not answer within ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Rejects when `promise` has not settled after `ms` (M63). Windows calls such as a screen capture
 * on the secure desktop can hang for good; the monitor must give up and try again, not wait.
 * The call itself keeps running in the background; only the wait is cut short.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'The call'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

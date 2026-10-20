import type { SimOptions } from './args.js';
import { SimStudent, type SimState } from './sim-student.js';

export interface SimCounts {
  total: number;
  joining: number;
  connecting: number;
  connected: number;
  failed: number;
}

export interface SimRun {
  counts(): SimCounts;
  /** Resolves when every student has either connected or failed. */
  settled(): Promise<void>;
  stop(): void;
  failures(): Map<string, string>;
}

/** Starts one fake student per code, `rampMs` apart. */
export function runSim(
  options: Pick<SimOptions, 'host' | 'port' | 'pin' | 'rampMs'>,
  codes: string[],
  pingMs?: number,
): SimRun {
  const states = new Map<string, SimState>();
  const failed = new Map<string, string>();
  let waiting: (() => void) | null = null;

  const check = () => {
    const done = [...states.values()].every((s) => s === 'connected' || s === 'failed');
    if (done && states.size === codes.length) waiting?.();
  };
  const onState = (code: string, state: SimState, detail?: string) => {
    states.set(code, state);
    if (state === 'failed') failed.set(code, detail ?? 'failed');
    else failed.delete(code);
    check();
  };

  const students = codes.map(
    (code) =>
      new SimStudent({
        target: { host: options.host, port: options.port },
        pin: options.pin,
        code,
        onState,
        ...(pingMs ? { pingMs } : {}),
      }),
  );
  let stopped = false;
  void (async () => {
    for (const student of students) {
      if (stopped) return;
      void student.start();
      if (options.rampMs > 0) await new Promise((r) => setTimeout(r, options.rampMs));
    }
  })();

  return {
    counts: () => {
      const counts: SimCounts = {
        total: codes.length,
        joining: codes.length - states.size,
        connecting: 0,
        connected: 0,
        failed: 0,
      };
      for (const s of states.values()) {
        if (s === 'connected') counts.connected += 1;
        else if (s === 'failed') counts.failed += 1;
        else if (s === 'connecting') counts.connecting += 1;
        else counts.joining += 1;
      }
      return counts;
    },
    settled: () =>
      new Promise((resolve) => {
        waiting = resolve;
        check();
      }),
    stop: () => {
      stopped = true;
      for (const s of students) s.stop();
    },
    failures: () => failed,
  };
}

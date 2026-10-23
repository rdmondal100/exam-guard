import type { SimOptions } from './args.js';
import type { SaveStats } from './sim-saves.js';
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
  /** Autosaves summed over all students. */
  saves(): SaveStats;
  /** Receipts, submits, drops and receipt problems summed over all students. */
  submits(): SubmitTotals;
}

export interface SubmitTotals {
  /** Students holding a receipt. */
  receipts: number;
  /** Of those, the ones that pressed Submit themselves. */
  selfSubmitted: number;
  disconnects: number;
  refused: number;
  /** Receipts that did not hold up (code and what was wrong). */
  problems: { code: string; problem: string }[];
}

/** Starts one fake student per code, `rampMs` apart. */
export function runSim(
  options: Pick<SimOptions, 'host' | 'port' | 'pin' | 'rampMs'> &
    Partial<Pick<SimOptions, 'autosaveMs' | 'submitAfterMs' | 'disconnectEveryMs'>>,
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
        ...(options.autosaveMs ? { autosaveMs: options.autosaveMs } : {}),
        ...(options.submitAfterMs ? { submitAfterMs: options.submitAfterMs } : {}),
        ...(options.disconnectEveryMs ? { disconnectEveryMs: options.disconnectEveryMs } : {}),
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
    saves: () => {
      const total: SaveStats = { sent: 0, acked: 0, pending: 0 };
      for (const s of students) {
        const one = s.saveStats();
        total.sent += one.sent;
        total.acked += one.acked;
        total.pending += one.pending;
      }
      return total;
    },
    submits: () => {
      const total: SubmitTotals = {
        receipts: 0,
        selfSubmitted: 0,
        disconnects: 0,
        refused: 0,
        problems: [],
      };
      students.forEach((s, i) => {
        const one = s.submitStats();
        if (one.receipt) total.receipts += 1;
        if (one.selfSubmitted) total.selfSubmitted += 1;
        total.disconnects += one.disconnects;
        total.refused += one.refused;
        for (const problem of one.problems) total.problems.push({ code: codes[i] ?? '?', problem });
      });
      return total;
    },
  };
}

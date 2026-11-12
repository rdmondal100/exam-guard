import { create } from 'zustand';
import { RUN_LIMITS, type RunResult } from '@examguard/shared';

/** One code buffer: `questionId.language`, the same key Monaco uses for its model path. */
export const runKey = (questionId: string, language: string) => `${questionId}.${language}`;

export interface RunState {
  /** The last finished run of each buffer. */
  results: Record<string, RunResult>;
  /** The buffer whose run is going, or `null`. Only one run at a time. */
  running: string | null;
  /** No new run before this time (ms, local clock). */
  cooldownUntil: number;
  start: (key: string) => void;
  finish: (key: string, result: RunResult, now: number) => void;
}

export const useRunStore = create<RunState>((set) => ({
  results: {},
  running: null,
  cooldownUntil: 0,
  // The old result (and its error underlines) goes away when a new run starts.
  start: (key) =>
    set((s) => ({
      running: key,
      results: Object.fromEntries(Object.entries(s.results).filter(([k]) => k !== key)),
    })),
  finish: (key, result, now) =>
    set((s) => {
      // A refusal (busy/cooldown) is not a run: keep the old state, only learn the wait.
      if (result.status === 'busy' || result.status === 'cooldown') {
        return {
          running: s.running === key ? null : s.running,
          cooldownUntil: now + (result.retryInMs ?? 0),
        };
      }
      return {
        running: s.running === key ? null : s.running,
        results: { ...s.results, [key]: result },
        cooldownUntil: now + RUN_LIMITS.cooldownMs,
      };
    }),
}));

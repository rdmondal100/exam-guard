import { useEffect, useRef, useState } from 'react';
import type { RestoreResult, RestoredAnswers } from '@examguard/shared';
import { useAnswerStore, type AnswerState } from './answerStore';
import { seedAutosaver } from './useAutosave';

export type RestoreOutcome = { ok: true } | { ok: false; message: string };

/**
 * Fills the editors from what main restored (the server's versions plus unsent local saves) and
 * tells the autosaver they are already saved. It does nothing when the student has already typed
 * in this app run: those buffers are newer than anything restored.
 */
export async function restoreIntoStore(
  fetchRestore: () => Promise<RestoreResult>,
  getStore: () => AnswerState,
  seed: (restored: RestoredAnswers) => void,
): Promise<RestoreOutcome> {
  if (Object.keys(getStore().answers).length > 0) return { ok: true };
  let result: RestoreResult;
  try {
    result = await fetchRestore();
  } catch {
    return { ok: false, message: 'Could not load your saved work.' };
  }
  if (!result.ok) return result;
  getStore().restore(result.answers);
  seed(result.answers);
  return { ok: true };
}

export type RestoreState =
  { name: 'working' } | { name: 'ready' } | { name: 'failed'; message: string };

/**
 * Restores the answers once when the exam screen is about to open. The screen must wait: typing
 * into an empty editor would hide, and then overwrite, the work the server still holds.
 */
export function useRestoreAnswers(wanted: boolean): { state: RestoreState; retry: () => void } {
  const [state, setState] = useState<RestoreState>({ name: 'working' });
  const [attempt, setAttempt] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (!wanted || done.current) return;
    let cancelled = false;
    setState({ name: 'working' });
    void restoreIntoStore(
      () => window.examguard.restoreAnswers(),
      () => useAnswerStore.getState(),
      seedAutosaver,
    ).then((outcome) => {
      if (cancelled) return;
      if (outcome.ok) {
        done.current = true;
        setState({ name: 'ready' });
      } else {
        setState({ name: 'failed', message: outcome.message });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, attempt]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}

import { useEffect, useRef, useState } from 'react';
import type { AnswerStatus, RestoredAnswers, SaveReason, StudentQuestion } from '@examguard/shared';
import { useAnswerStore } from './answerStore';
import { AUTOSAVE_MS, Autosaver } from './autosave';

type Questions = readonly Pick<StudentQuestion, 'id' | 'type' | 'allowedLanguages'>[];

/**
 * What the server was last given, kept for the whole app run (not per screen) so that a restore
 * after a restart can mark its buffers as already saved.
 */
const saver = new Autosaver();

/** Marks restored buffers as saved, so the next tick does not send them again. */
export function seedAutosaver(restored: RestoredAnswers): void {
  saver.seed(restored);
}

/** The running scheduler, so a Run (or a later Submit) can ask for a save from anywhere. */
let active: { questions: Questions } | null = null;

/**
 * Sends every changed buffer now. Does nothing outside the exam screen. Resolves once main has
 * taken all of them (not when the server acked).
 */
export async function saveNow(reason: SaveReason): Promise<void> {
  if (!active) return;
  const { questions } = active;
  const { answers, flags, languages } = useAnswerStore.getState();
  await Promise.all(
    saver
      .collect({ questions, answers, flags, languages }, reason)
      .map((request) => window.examguard.saveAnswer(request).catch(() => saver.forget(request))),
  );
}

/**
 * Autosave for the exam screen: every 10 s for what changed, and at once when the student
 * changes question or language (a Run calls `saveNow('run')`).
 */
export function useAutosave(questions: Questions, selectedId: string): void {
  useEffect(() => {
    active = { questions };
    const tick = setInterval(() => void saveNow('interval'), AUTOSAVE_MS);
    const unsubscribe = useAnswerStore.subscribe((state, before) => {
      if (state.languages !== before.languages) void saveNow('switch_language');
    });
    return () => {
      clearInterval(tick);
      unsubscribe();
      void saveNow('interval');
      active = null;
    };
  }, [questions]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else void saveNow('switch_question');
  }, [selectedId]);
}

/** How many saves still wait for the server, pushed from main. */
export function useAnswerStatus(): AnswerStatus {
  const [status, setStatus] = useState<AnswerStatus>({ pending: 0, lastAckAt: null });
  useEffect(() => window.examguard.onAnswerStatus(setStatus), []);
  return status;
}

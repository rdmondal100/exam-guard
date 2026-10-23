import { useEffect, useRef, useState } from 'react';
import type { AnswerStatus, SaveReason, StudentQuestion } from '@examguard/shared';
import { useAnswerStore } from './answerStore';
import { AUTOSAVE_MS, Autosaver } from './autosave';

type Questions = readonly Pick<StudentQuestion, 'id' | 'type' | 'allowedLanguages'>[];

/** The running scheduler, so a Run (or a later Submit) can ask for a save from anywhere. */
let active: { saver: Autosaver; questions: Questions } | null = null;

/** Sends every changed buffer now. Does nothing outside the exam screen. */
export function saveNow(reason: SaveReason): void {
  if (!active) return;
  const { saver, questions } = active;
  const { answers, flags, languages } = useAnswerStore.getState();
  for (const request of saver.collect({ questions, answers, flags, languages }, reason)) {
    window.examguard.saveAnswer(request).catch(() => saver.forget(request));
  }
}

/**
 * Autosave for the exam screen: every 10 s for what changed, and at once when the student
 * changes question or language (a Run calls `saveNow('run')`).
 */
export function useAutosave(questions: Questions, selectedId: string): void {
  const saver = useRef(new Autosaver());
  useEffect(() => {
    active = { saver: saver.current, questions };
    const tick = setInterval(() => saveNow('interval'), AUTOSAVE_MS);
    const unsubscribe = useAnswerStore.subscribe((state, before) => {
      if (state.languages !== before.languages) saveNow('switch_language');
    });
    return () => {
      clearInterval(tick);
      unsubscribe();
      saveNow('interval');
      active = null;
    };
  }, [questions]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else saveNow('switch_question');
  }, [selectedId]);
}

/** How many saves still wait for the server, pushed from main. */
export function useAnswerStatus(): AnswerStatus {
  const [status, setStatus] = useState<AnswerStatus>({ pending: 0, lastAckAt: null });
  useEffect(() => window.examguard.onAnswerStatus(setStatus), []);
  return status;
}

import { createContext, useContext, useEffect, useMemo } from 'react';
import type { LargeInsertionReport } from '@examguard/shared';
import {
  insertedByMonaco,
  insertedInBox,
  InsertionWatch,
  type BoxBefore,
  type ModelChange,
} from '@/lib/insertionWatch';

/** Typing has paused this long: the burst so far is judged. */
const FLUSH_IDLE_MS = 150;

/** The part of a Monaco editor the watch hooks into. */
export interface WatchedEditor {
  onDidChangeModelContent(listener: (event: ModelChange) => void): { dispose(): void };
  getModel(): { getValue(): string } | null;
}

export interface InsertionWatchHandle {
  /** The paste guard allowed this text (a paste or drop from inside the exam). */
  allow(text: string): void;
  /** Watches one Monaco editor; returns the stop function. */
  attach(editor: WatchedEditor): () => void;
}

/** Given by the exam screen to its editors (code answers and the Files editor). */
export const InsertionWatchContext = createContext<InsertionWatchHandle | null>(null);

/** Monaco editors call this on mount; outside the exam screen it does nothing. */
export function useInsertionWatchHandle(): InsertionWatchHandle | null {
  return useContext(InsertionWatchContext);
}

const insideOwnEditor = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('.monaco-editor, .xterm') !== null;

/**
 * Large text insertion detection for the exam window (M27): key and input events mark typing,
 * Monaco edits and answer-box input are fed to an `InsertionWatch`, and a burst over the limits
 * is reported to main, which logs a `large_insertion` event.
 */
export function useInsertionWatch(): InsertionWatchHandle {
  const parts = useMemo(() => {
    const watch = new InsertionWatch();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = (report: LargeInsertionReport | null) => {
      if (report) window.examguard.reportLargeInsertion(report).catch(() => undefined);
    };
    const landed = (text: string | null, surface: 'editor' | 'answer') => {
      if (!text) return;
      send(watch.insert(text, surface, performance.now()));
      clearTimeout(timer);
      timer = setTimeout(() => send(watch.finish()), FLUSH_IDLE_MS);
    };
    const handle: InsertionWatchHandle = {
      allow: (text) => watch.allow(text, performance.now()),
      attach: (editor) => {
        const subscription = editor.onDidChangeModelContent((event) =>
          landed(
            insertedByMonaco(event, () => editor.getModel()?.getValue() ?? ''),
            'editor',
          ),
        );
        return () => subscription.dispose();
      },
    };
    const stop = () => {
      clearTimeout(timer);
      send(watch.finish());
    };
    return { watch, handle, landed, stop };
  }, []);

  useEffect(() => {
    const { watch, landed, stop } = parts;
    const boxes = new WeakMap<EventTarget, BoxBefore>();
    const typed = (e: Event) => watch.userInput(e.timeStamp, performance.now());
    const beforeInput = (e: Event) => {
      typed(e);
      const box = e.target;
      if (box instanceof HTMLTextAreaElement && !insideOwnEditor(box)) {
        boxes.set(box, {
          length: box.value.length,
          selected: Math.max(0, box.selectionEnd - box.selectionStart),
        });
      }
    };
    const input = (e: Event) => {
      const box = e.target;
      if (!(box instanceof HTMLTextAreaElement) || insideOwnEditor(box)) return;
      const { inputType = '', data = null } = e as InputEvent;
      landed(insertedInBox(inputType, data, boxes.get(box), box.value, box.selectionEnd), 'answer');
    };
    window.addEventListener('keydown', typed, true);
    window.addEventListener('compositionend', typed, true);
    window.addEventListener('beforeinput', beforeInput, true);
    window.addEventListener('input', input, true);
    return () => {
      window.removeEventListener('keydown', typed, true);
      window.removeEventListener('compositionend', typed, true);
      window.removeEventListener('beforeinput', beforeInput, true);
      window.removeEventListener('input', input, true);
      stop();
    };
  }, [parts]);

  return parts.handle;
}

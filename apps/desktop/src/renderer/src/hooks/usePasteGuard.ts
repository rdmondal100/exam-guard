import { useEffect, useRef, useState } from 'react';
import { checkPaste, PasteGuard, watchClipboardWrites } from '@/lib/pasteGuard';

/** Selected text in the focused text box, or else on the page. */
function selectedText(): string {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    const { selectionStart, selectionEnd, value } = active;
    if (selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart) {
      return value.slice(selectionStart, selectionEnd);
    }
  }
  return window.getSelection()?.toString() ?? '';
}

/**
 * The paste guard of the exam window (M25): text copied or cut inside the window may be pasted
 * anywhere in it; any other text pasted or dropped is blocked and reported to main, which logs a
 * `paste_blocked` event. `onAllowed` hears each paste or drop let through (the large-insertion
 * watch, M27). Returns when the last paste was blocked, for a short notice.
 */
export function usePasteGuard(onAllowed?: (text: string) => void): number | null {
  const [blockedAt, setBlockedAt] = useState<number | null>(null);
  // Read through a ref so a new callback does not re-register the listeners.
  const allowedRef = useRef(onAllowed);
  useEffect(() => {
    allowedRef.current = onAllowed;
  }, [onAllowed]);

  useEffect(() => {
    const guard = new PasteGuard();
    let dragInside = false;

    // Capture phase: runs before Monaco and xterm, which write the clipboard themselves.
    const onCopy = (e: ClipboardEvent) => {
      guard.remember(selectedText());
      if (e.clipboardData) watchClipboardWrites(e.clipboardData, guard);
    };
    const block = (e: Event, text: string) => {
      const report = checkPaste(guard, text, e.target);
      if (!report) return allowedRef.current?.(text);
      e.preventDefault();
      e.stopImmediatePropagation();
      setBlockedAt(Date.now());
      window.examguard.reportPasteBlocked(report).catch(() => undefined);
    };
    const onPaste = (e: ClipboardEvent) => block(e, e.clipboardData?.getData('text/plain') ?? '');
    const onDragStart = () => {
      dragInside = true;
    };
    const onDragEnd = () => {
      dragInside = false;
    };
    const onDrop = (e: DragEvent) => {
      if (dragInside) {
        dragInside = false;
        return allowedRef.current?.(e.dataTransfer?.getData('text/plain') ?? '');
      }
      block(e, e.dataTransfer?.getData('text/plain') ?? '');
    };

    window.addEventListener('copy', onCopy, true);
    window.addEventListener('cut', onCopy, true);
    window.addEventListener('paste', onPaste, true);
    window.addEventListener('drop', onDrop, true);
    window.addEventListener('dragstart', onDragStart, true);
    window.addEventListener('dragend', onDragEnd, true);
    return () => {
      window.removeEventListener('copy', onCopy, true);
      window.removeEventListener('cut', onCopy, true);
      window.removeEventListener('paste', onPaste, true);
      window.removeEventListener('drop', onDrop, true);
      window.removeEventListener('dragstart', onDragStart, true);
      window.removeEventListener('dragend', onDragEnd, true);
    };
  }, []);

  return blockedAt;
}

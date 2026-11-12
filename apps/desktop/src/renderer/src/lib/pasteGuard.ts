import { PASTE_PREVIEW_CHARS, type PasteBlockedReport, type PasteSurface } from '@examguard/shared';

/** How many copied texts are remembered; the oldest go first. */
export const MAX_REMEMBERED = 500;

/** Windows puts `\r\n` on the clipboard for text copied with `\n`; both count as the same text. */
const normalize = (text: string): string => text.replace(/\r\n?/g, '\n');

/** FNV-1a over the UTF-16 units, with the length, so a full copy of the text is not kept. */
function keyOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length}:${hash.toString(36)}`;
}

/**
 * What was copied or cut inside the exam window (M25). Only such text may be pasted back; empty
 * text (a picture, nothing) is never blocked, since nothing would be inserted.
 */
export class PasteGuard {
  private readonly keys = new Set<string>();

  remember(text: string): void {
    const value = normalize(text);
    if (!value) return;
    const key = keyOf(value);
    this.keys.delete(key);
    this.keys.add(key);
    if (this.keys.size > MAX_REMEMBERED) {
      const oldest = this.keys.values().next().value;
      if (oldest !== undefined) this.keys.delete(oldest);
    }
  }

  allows(text: string): boolean {
    const value = normalize(text);
    return value === '' || this.keys.has(keyOf(value));
  }
}

/** Size and a short preview of a blocked paste, for the teacher's event. */
export function describePaste(text: string, surface: PasteSurface): PasteBlockedReport {
  const value = normalize(text);
  return {
    surface,
    chars: value.length,
    lines: value === '' ? 0 : value.split('\n').length,
    preview: value.slice(0, PASTE_PREVIEW_CHARS),
  };
}

/** The part of a DOM element the surface check needs. */
export interface ElementLike {
  tagName?: string;
  closest?(selector: string): unknown;
}

/** Where a paste landed: a code editor, the terminal or program console, an answer box, or else. */
export function surfaceOf(target: unknown): PasteSurface {
  const element = (target ?? {}) as ElementLike;
  if (typeof element.closest !== 'function') return 'other';
  if (element.closest('.xterm')) return 'terminal';
  if (element.closest('.monaco-editor')) return 'editor';
  return element.tagName === 'TEXTAREA' ? 'answer' : 'other';
}

/** The paste guard's decision: `null` lets it through, a report means block and log it. */
export function checkPaste(
  guard: PasteGuard,
  text: string,
  target: unknown,
): PasteBlockedReport | null {
  return guard.allows(text) ? null : describePaste(text, surfaceOf(target));
}

/** The part of a clipboard `DataTransfer` the copy hook touches. */
export interface WritableClipboard {
  setData(type: string, value: string): void;
}

/**
 * Remembers whatever a handler later in the same copy/cut event writes as plain text (Monaco and
 * xterm write the selection themselves and may stop the event from reaching other listeners).
 */
export function watchClipboardWrites(data: WritableClipboard, guard: PasteGuard): void {
  const write = data.setData.bind(data);
  data.setData = (type, value) => {
    if (type === 'text/plain' || type === 'text') guard.remember(value);
    write(type, value);
  };
}

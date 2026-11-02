import { describe, expect, it } from 'vitest';
import {
  MAX_REMEMBERED,
  PasteGuard,
  checkPaste,
  describePaste,
  surfaceOf,
  watchClipboardWrites,
} from './pasteGuard';

/** A stand-in for a DOM element: `closest` matches the given class names. */
const element = (tagName: string, inside: string[] = []) => ({
  tagName,
  closest: (selector: string) => (inside.includes(selector) ? {} : null),
});

describe('PasteGuard', () => {
  it('allows text copied inside the exam and blocks anything else', () => {
    const guard = new PasteGuard();
    guard.remember('int main() {}');
    expect(guard.allows('int main() {}')).toBe(true);
    expect(guard.allows('int main() { }')).toBe(false);
  });

  it('treats Windows and Unix line endings as the same text', () => {
    const guard = new PasteGuard();
    guard.remember('a\nb\n');
    expect(guard.allows('a\r\nb\r\n')).toBe(true);
  });

  it('never blocks an empty paste', () => {
    expect(new PasteGuard().allows('')).toBe(true);
  });

  it('forgets the oldest copies beyond the limit', () => {
    const guard = new PasteGuard();
    for (let i = 0; i <= MAX_REMEMBERED; i++) guard.remember(`copy ${i}`);
    expect(guard.allows('copy 0')).toBe(false);
    expect(guard.allows('copy 1')).toBe(true);
    expect(guard.allows(`copy ${MAX_REMEMBERED}`)).toBe(true);
  });
});

describe('describePaste and checkPaste', () => {
  it('counts characters and lines and keeps a 200-character preview', () => {
    const report = describePaste(`${'x'.repeat(250)}\r\nend`, 'editor');
    expect(report.chars).toBe(254);
    expect(report.lines).toBe(2);
    expect(report.preview).toHaveLength(200);
  });

  it('reports a blocked paste with where it landed and lets an inside copy through', () => {
    const guard = new PasteGuard();
    guard.remember('mine');
    expect(checkPaste(guard, 'mine', element('DIV', ['.monaco-editor']))).toBeNull();
    expect(checkPaste(guard, 'from chrome', element('TEXTAREA', ['.xterm']))).toEqual({
      surface: 'terminal',
      chars: 11,
      lines: 1,
      preview: 'from chrome',
    });
  });
});

describe('surfaceOf', () => {
  it('tells the editor, the terminal, an answer box and the rest apart', () => {
    expect(surfaceOf(element('DIV', ['.monaco-editor']))).toBe('editor');
    expect(surfaceOf(element('TEXTAREA', ['.xterm']))).toBe('terminal');
    expect(surfaceOf(element('TEXTAREA'))).toBe('answer');
    expect(surfaceOf(element('INPUT'))).toBe('other');
    expect(surfaceOf(null)).toBe('other');
  });
});

describe('watchClipboardWrites', () => {
  it('remembers the plain text a later handler writes and still writes it', () => {
    const guard = new PasteGuard();
    const written: [string, string][] = [];
    const data = { setData: (type: string, value: string) => void written.push([type, value]) };
    watchClipboardWrites(data, guard);
    data.setData('text/plain', 'copied in monaco');
    data.setData('vscode-editor-data', '{"x":1}');
    expect(written).toHaveLength(2);
    expect(guard.allows('copied in monaco')).toBe(true);
    expect(guard.allows('{"x":1}')).toBe(false);
  });
});

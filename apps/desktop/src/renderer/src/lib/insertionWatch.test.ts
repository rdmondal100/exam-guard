import { describe, expect, it } from 'vitest';
import {
  ALLOWANCE_MS,
  DUPLICATE_MIN_CHARS,
  INPUT_WINDOW_MS,
  insertedByMonaco,
  insertedInBox,
  InsertionWatch,
  type ModelChange,
} from './insertionWatch';

/** Types `text` one key at a time, `gapMs` apart (by the key's own time stamp). */
function type(watch: InsertionWatch, text: string, gapMs: number, start = 1000) {
  const reports = [];
  let stamp = start;
  for (const ch of text) {
    watch.userInput(stamp, stamp);
    const ended = watch.insert(ch, 'editor', stamp + 1);
    if (ended) reports.push(ended);
    stamp += gapMs;
  }
  return reports;
}

describe('InsertionWatch', () => {
  it('flags a typing-tool burst of 300 characters', () => {
    const watch = new InsertionWatch();
    expect(type(watch, 'x'.repeat(300), 2)).toEqual([]);
    expect(watch.finish()).toMatchObject({
      surface: 'editor',
      chars: 300,
      lines: 0,
      durationMs: 598,
      preview: 'x'.repeat(200),
    });
  });

  it('does not flag normal typing or a held key (auto-repeat about 33 ms)', () => {
    const watch = new InsertionWatch();
    expect(type(watch, 'a'.repeat(400), 120)).toEqual([]);
    expect(watch.finish()).toBeNull();
    expect(type(watch, 'b'.repeat(400), 33)).toEqual([]);
    expect(watch.finish()).toBeNull();
  });

  it('flags five new lines arriving in one burst, and one large insertion at once', () => {
    const watch = new InsertionWatch();
    type(watch, 'a\nb\nc\nd\ne\n', 1);
    expect(watch.finish()).toMatchObject({ lines: 5, chars: 10 });
    watch.userInput(5000, 5000);
    expect(watch.insert('y'.repeat(201), 'answer', 5001)).toBeNull();
    expect(watch.finish()).toMatchObject({ surface: 'answer', chars: 201, durationMs: 0 });
  });

  it('reports a finished burst when the next key comes after a pause', () => {
    const watch = new InsertionWatch();
    type(watch, 'z'.repeat(250), 1, 1000);
    watch.userInput(3000, 3000);
    expect(watch.insert('q', 'editor', 3001)).toMatchObject({ chars: 250 });
    expect(watch.finish()).toBeNull();
  });

  it('lets an allowed paste land once, within the allowance time', () => {
    const watch = new InsertionWatch();
    const pasted = 'p'.repeat(500);
    watch.userInput(100, 100);
    watch.allow(pasted, 100);
    expect(watch.insert(pasted, 'editor', 110)).toBeNull();
    expect(watch.finish()).toBeNull();
    // A second landing of the same size is not covered.
    watch.userInput(200, 200);
    watch.insert(pasted, 'editor', 210);
    expect(watch.finish()).toMatchObject({ chars: 500 });
    // Nor is one after the allowance ran out.
    watch.allow(pasted, 1000);
    watch.userInput(1000 + ALLOWANCE_MS + 1, 1000 + ALLOWANCE_MS + 1);
    watch.insert(pasted, 'editor', 1000 + ALLOWANCE_MS + 2);
    expect(watch.finish()).toMatchObject({ chars: 500 });
  });

  it('ignores text set by the app (no key or input event just before) and plain indenting', () => {
    const watch = new InsertionWatch();
    watch.userInput(0, 0);
    expect(watch.insert('r'.repeat(900), 'editor', INPUT_WINDOW_MS + 1)).toBeNull();
    expect(watch.finish()).toBeNull();
    watch.userInput(1000, 1000);
    watch.insert(' '.repeat(400), 'editor', 1001);
    expect(watch.finish()).toBeNull();
  });

  it('counts Windows line ends once', () => {
    const watch = new InsertionWatch();
    watch.userInput(10, 10);
    watch.insert('1\r\n2\r\n3\r\n4\r\n5\r\n6', 'answer', 11);
    expect(watch.finish()).toMatchObject({ lines: 5, chars: 11 });
  });
});

const change = (text: string, rangeLength = 0, over: Partial<ModelChange> = {}): ModelChange => ({
  isFlush: false,
  isUndoing: false,
  isRedoing: false,
  changes: [{ text, rangeLength }],
  ...over,
});

describe('insertedByMonaco', () => {
  it('returns the typed or inserted text', () => {
    expect(insertedByMonaco(change('a'), () => 'a')).toBe('a');
    expect(insertedByMonaco(change('abc', 1), () => 'abc')).toBe('abc');
  });

  it('skips undo, redo, values set by the app, multi-place edits and moves', () => {
    expect(insertedByMonaco(change('x', 0, { isUndoing: true }), () => '')).toBeNull();
    expect(insertedByMonaco(change('x', 0, { isRedoing: true }), () => '')).toBeNull();
    expect(insertedByMonaco(change('x', 0, { isFlush: true }), () => '')).toBeNull();
    const twoPlaces: ModelChange = {
      ...change('x'),
      changes: [
        { text: '    ', rangeLength: 0 },
        { text: '    ', rangeLength: 0 },
      ],
    };
    expect(insertedByMonaco(twoPlaces, () => '')).toBeNull();
    expect(insertedByMonaco(change('line b\nline a\n', 14), () => '')).toBeNull();
  });

  it('skips a long copy of text already in the editor (copy line down)', () => {
    const line = 'int total = compute(values, count) + offset;\n';
    expect(line.length).toBeGreaterThanOrEqual(DUPLICATE_MIN_CHARS);
    expect(insertedByMonaco(change(line), () => line + line)).toBeNull();
    expect(insertedByMonaco(change(line), () => line)).toBe(line);
  });
});

describe('insertedInBox', () => {
  it('uses the typed data, or the grown part of the value', () => {
    expect(insertedInBox('insertText', 'k', undefined, 'ok', 2)).toBe('k');
    expect(
      insertedInBox('insertReplacementText', null, { length: 3, selected: 1 }, 'aXYc', 3),
    ).toBe('XY');
  });

  it('skips undo, redo, deletes and unknown state', () => {
    expect(insertedInBox('historyUndo', null, { length: 0, selected: 0 }, 'lots', 4)).toBeNull();
    expect(
      insertedInBox('deleteContentBackward', null, { length: 4, selected: 0 }, 'abc', 3),
    ).toBeNull();
    expect(insertedInBox('insertFromDrop', null, undefined, 'abc', 3)).toBeNull();
  });
});

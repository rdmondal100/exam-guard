import {
  INSERTION_BURST_GAP_MS,
  LARGE_INSERTION_CHARS,
  LARGE_INSERTION_LINES,
  PASTE_PREVIEW_CHARS,
  type LargeInsertionReport,
  type PasteSurface,
} from '@examguard/shared';

/** Text that lands this soon after a key or input event was handled counts as typed. */
export const INPUT_WINDOW_MS = 100;
/** After an allowed paste or drop inside the exam, its text may land within this time. */
export const ALLOWANCE_MS = 500;
/** A one-edit copy of text already in the editor (copy line down) this long is the editor's own. */
export const DUPLICATE_MIN_CHARS = 40;

const normalize = (text: string): string => text.replace(/\r\n?/g, '\n');
const newlines = (text: string): number => text.split('\n').length - 1;

interface Burst {
  firstStamp: number;
  lastStamp: number;
  chars: number;
  lines: number;
  preview: string;
  surface: PasteSurface;
}

export interface InsertionLimits {
  gapMs: number;
  chars: number;
  lines: number;
}

const LIMITS: InsertionLimits = {
  gapMs: INSERTION_BURST_GAP_MS,
  chars: LARGE_INSERTION_CHARS,
  lines: LARGE_INSERTION_LINES,
};

/**
 * Large text insertion detection (M27). Text that lands in an editor or answer box right after a
 * key or input event is grouped into bursts by the events' own time stamps (`event.timeStamp`,
 * set when the key was pressed, not when the page got round to it): keys less than `gapMs` apart
 * belong to one burst. A burst over the limits is reported when it ends, unless the text was an
 * allowed paste or drop. Text set by the app itself (no key or input event just before) is ignored.
 */
export class InsertionWatch {
  private handledAt = Number.NEGATIVE_INFINITY;
  private stamp = Number.NEGATIVE_INFINITY;
  private allowance: { until: number; budget: number } | null = null;
  private burst: Burst | null = null;

  constructor(private readonly limits: InsertionLimits = LIMITS) {}

  /** A key press or input event: `stamp` = its `timeStamp`, `now` = `performance.now()`. */
  userInput(stamp: number, now: number): void {
    this.stamp = stamp;
    this.handledAt = now;
  }

  /** The paste guard let a paste (or a drop from inside the exam) through: it may now land. */
  allow(text: string, now: number): void {
    const length = normalize(text).length;
    if (length > 0) this.allowance = { until: now + ALLOWANCE_MS, budget: length * 2 + 100 };
  }

  /**
   * Text that just landed. Returns the report of the burst that ended before it, when that one was
   * over the limits.
   */
  insert(text: string, surface: PasteSurface, now: number): LargeInsertionReport | null {
    const value = normalize(text);
    if (!value) return null;
    const allowance = this.allowance;
    if (allowance && now <= allowance.until && value.length <= allowance.budget) {
      this.allowance = null;
      return null;
    }
    if (now - this.handledAt > INPUT_WINDOW_MS) return null;
    // Indenting a block (Tab on a selection) inserts only spaces.
    if (!/\S/.test(value) && !value.includes('\n')) return null;
    const ended =
      this.burst && this.stamp - this.burst.lastStamp > this.limits.gapMs ? this.finish() : null;
    const burst = (this.burst ??= {
      firstStamp: this.stamp,
      lastStamp: this.stamp,
      chars: 0,
      lines: 0,
      preview: '',
      surface,
    });
    burst.lastStamp = this.stamp;
    burst.chars += value.length;
    burst.lines += newlines(value);
    burst.surface = surface;
    if (burst.preview.length < PASTE_PREVIEW_CHARS) {
      burst.preview = (burst.preview + value).slice(0, PASTE_PREVIEW_CHARS);
    }
    return ended;
  }

  /** Ends the current burst (typing paused); its report when it was over the limits. */
  finish(): LargeInsertionReport | null {
    const burst = this.burst;
    this.burst = null;
    if (!burst || (burst.chars <= this.limits.chars && burst.lines < this.limits.lines)) {
      return null;
    }
    return {
      surface: burst.surface,
      chars: burst.chars,
      lines: burst.lines,
      durationMs: Math.max(0, Math.round(burst.lastStamp - burst.firstStamp)),
      preview: burst.preview,
    };
  }
}

/** The parts of a Monaco content change the watch reads. */
export interface ModelChange {
  isFlush: boolean;
  isUndoing: boolean;
  isRedoing: boolean;
  changes: readonly { text: string; rangeLength: number }[];
}

/**
 * The text a Monaco edit inserted, or `null` for the editor's own work: undo/redo, a value set
 * by the app, edits at several places at once (rename, indent a block, multi-cursor), a move or
 * a replacement that adds nothing, and a long copy of text that is already in the editor.
 */
export function insertedByMonaco(event: ModelChange, value: () => string): string | null {
  if (event.isFlush || event.isUndoing || event.isRedoing || event.changes.length !== 1) {
    return null;
  }
  const [change] = event.changes;
  if (!change || change.text.length <= change.rangeLength) return null;
  const { text } = change;
  if (text.length >= DUPLICATE_MIN_CHARS) {
    const all = value();
    const first = all.indexOf(text);
    if (first !== -1 && all.indexOf(text, first + 1) !== -1) return null;
  }
  return text;
}

/** A text box's value and selection just before an input event changed it. */
export interface BoxBefore {
  length: number;
  selected: number;
}

/** The text an input event put into a text box (`data` when the browser gives it). */
export function insertedInBox(
  inputType: string,
  data: string | null,
  before: BoxBefore | undefined,
  value: string,
  caret: number,
): string | null {
  if (inputType.startsWith('history') || inputType.startsWith('delete')) return null;
  if (data) return data;
  if (!before) return null;
  const added = value.length - (before.length - before.selected);
  return added > 0 ? value.slice(Math.max(0, caret - added), caret) : null;
}

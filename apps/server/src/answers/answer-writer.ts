import type { AnswerRepo, NewAnswerVersion } from '../db/answer-repo.js';

/** Flush after this long since the first waiting row, or when this many rows are waiting. */
export const ANSWER_FLUSH_MS = 250;
export const ANSWER_FLUSH_ROWS = 200;

interface Waiting {
  row: NewAnswerVersion;
  onCommitted: () => void;
}

export interface AnswerWriterOptions {
  flushMs?: number;
  maxRows?: number;
  /** A row the database refuses (for example its question was deleted) is reported and dropped. */
  onRejected?: (row: NewAnswerVersion, error: unknown) => void;
}

/**
 * Collects autosaves and writes them in one transaction every 250 ms or every 200 rows, so 200
 * students saving at once cost a few transactions a second. `onCommitted` runs after the commit,
 * which is when the student may be told the save is safe.
 */
export class AnswerWriter {
  private queue: Waiting[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushMs: number;
  private readonly maxRows: number;

  constructor(
    private readonly repo: AnswerRepo,
    private readonly options: AnswerWriterOptions = {},
  ) {
    this.flushMs = options.flushMs ?? ANSWER_FLUSH_MS;
    this.maxRows = options.maxRows ?? ANSWER_FLUSH_ROWS;
  }

  get waiting(): number {
    return this.queue.length;
  }

  enqueue(row: NewAnswerVersion, onCommitted: () => void): void {
    this.queue.push({ row, onCommitted });
    if (this.queue.length >= this.maxRows) return this.flush();
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushMs);
      this.timer.unref();
    }
  }

  /** Writes everything waiting now. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.queue.splice(0, this.queue.length);
    if (batch.length === 0) return;
    try {
      this.repo.insertMany(batch.map((w) => w.row));
    } catch {
      // One bad row must not hold back the others: write the rows one by one.
      for (const w of batch) this.writeOne(w);
      return;
    }
    for (const w of batch) w.onCommitted();
  }

  private writeOne(w: Waiting): void {
    try {
      this.repo.insertMany([w.row]);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
        // Can never be stored: acked anyway, so the client does not re-send it for ever.
        this.options.onRejected?.(w.row, error);
        return w.onCommitted();
      }
      // Anything else may pass (a busy or full disk): keep it and try again, never ack unsaved work.
      this.queue.push(w);
      if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.flushMs);
        this.timer.unref();
      }
      return;
    }
    w.onCommitted();
  }
}

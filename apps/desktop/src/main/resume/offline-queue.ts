import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  AnswerSaveSchema,
  EventReportSchema,
  TranscriptChunkSchema,
  type AnswerSave,
  type EventReport,
  type TranscriptChunk,
} from '@examguard/shared';
import type { SecretBox } from './secret-box.js';

/** A frame that must reach the server even if the app or the network goes down first. */
export type QueueItem = AnswerSave | EventReport | TranscriptChunk;

export function queueKey(item: QueueItem): string {
  if (item.t === 'answer.save') return `s${item.clientSeq}`;
  return item.t === 'event' ? `e${item.id}` : `c${item.key}`;
}

function parseItem(json: string): QueueItem | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  for (const schema of [AnswerSaveSchema, EventReportSchema, TranscriptChunkSchema]) {
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/** Tombstones are compacted away once they outnumber the live lines and pile up this far. */
const COMPACT_AFTER = 100;

/**
 * The frames the server has not acked yet, kept in an append-only file: one encrypted line per
 * frame and a `-<key>` line when it is acked. A write that fails is logged and never thrown, since
 * the frame is still in memory and in the retry loop; the file only protects against a restart.
 */
export class OfflineQueue {
  /** key → the encrypted line, so a compaction does not need to encrypt again. */
  private readonly live = new Map<string, string>();
  private tombstones = 0;
  private warned = false;
  /** After `clear()` nothing more is written: the exam is over for this queue. */
  private closed = false;

  constructor(
    private readonly file: string,
    private readonly box: SecretBox,
    private readonly log: (message: string) => void = (m) => console.warn(m),
  ) {}

  /** Reads the file and returns what is still unacked, oldest first. Skips lines it cannot read. */
  load(): QueueItem[] {
    this.live.clear();
    this.tombstones = 0;
    this.closed = false;
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return [];
    }
    const items = new Map<string, QueueItem>();
    for (const line of text.split('\n')) {
      if (!line) continue;
      if (line.startsWith('-')) {
        items.delete(line.slice(1));
        this.live.delete(line.slice(1));
        continue;
      }
      const json = this.box.decrypt(line);
      const item = json === null ? null : parseItem(json);
      if (!item) continue;
      const key = queueKey(item);
      items.set(key, item);
      this.live.set(key, line);
    }
    // Start the next run from a file with no dead lines.
    this.rewrite();
    return [...items.values()];
  }

  add(item: QueueItem): void {
    if (this.closed) return;
    const line = this.box.encrypt(JSON.stringify(item));
    if (line === null)
      return this.warnOnce('Cannot encrypt the offline queue; keeping it in memory');
    this.live.set(queueKey(item), line);
    this.write(() => appendFileSync(this.file, `${line}\n`));
  }

  remove(key: string): void {
    if (!this.live.delete(key)) return;
    if (this.live.size === 0) return this.rewrite();
    this.tombstones += 1;
    this.write(() => appendFileSync(this.file, `-${key}\n`));
    if (this.tombstones > COMPACT_AFTER && this.tombstones > this.live.size) this.rewrite();
  }

  /** Forgets everything and removes the file. */
  clear(): void {
    this.closed = true;
    this.live.clear();
    this.tombstones = 0;
    this.write(() => rmSync(this.file, { force: true }));
  }

  private rewrite(): void {
    this.tombstones = 0;
    if (this.live.size === 0) {
      return this.write(() => rmSync(this.file, { force: true }));
    }
    const body = [...this.live.values()].map((line) => `${line}\n`).join('');
    this.write(() => writeFileSync(this.file, body));
  }

  private write(action: () => void): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      action();
    } catch (e) {
      this.warnOnce(`Offline queue write failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private warnOnce(message: string): void {
    if (this.warned) return;
    this.warned = true;
    this.log(message);
  }
}

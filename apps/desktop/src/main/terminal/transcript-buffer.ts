import { randomUUID } from 'node:crypto';
import { MAX_TRANSCRIPT_CHUNK } from '@examguard/shared';

/** Client-side cap per app run; the server keeps at most 1 MB per student anyway. */
export const MAX_TRANSCRIPT_SENT = 1024 * 1024 + MAX_TRANSCRIPT_CHUNK;

export interface TranscriptBufferDeps {
  send: (key: string, text: string) => void;
  flushMs?: number;
  /** Keys are `<run id>:<n>`, so an app restart never reuses one. */
  runId?: string;
}

/** Cut point at or before `max` that does not split a surrogate pair. */
function cutAt(text: string, max: number): number {
  if (text.length <= max) return text.length;
  const code = text.charCodeAt(max - 1);
  return code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
}

/**
 * Collects the terminal output the student saw and sends it in chunks of at most 16 KB, about
 * every 2 s, or at once when a chunk is full.
 */
export class TranscriptBuffer {
  private pending = '';
  private sent = 0;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly runId: string;

  constructor(private readonly deps: TranscriptBufferDeps) {
    this.runId = deps.runId ?? randomUUID();
  }

  append(text: string): void {
    if (!text || this.sent >= MAX_TRANSCRIPT_SENT) return;
    this.pending += text;
    if (this.pending.length >= MAX_TRANSCRIPT_CHUNK) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), this.deps.flushMs ?? 2000);
  }

  /** Sends everything held back now (also on terminal exit). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.pending && this.sent < MAX_TRANSCRIPT_SENT) {
      const n = cutAt(this.pending, MAX_TRANSCRIPT_CHUNK);
      const text = this.pending.slice(0, n);
      this.pending = this.pending.slice(n);
      this.seq += 1;
      this.sent += text.length;
      this.deps.send(`${this.runId}:${this.seq}`, text);
    }
    if (this.sent >= MAX_TRANSCRIPT_SENT) this.pending = '';
  }
}

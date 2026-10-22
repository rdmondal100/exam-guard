import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_TRANSCRIPT_CHUNK } from '@examguard/shared';
import { MAX_TRANSCRIPT_SENT, TranscriptBuffer } from './transcript-buffer.js';

let sent: [string, string][];
let buffer: TranscriptBuffer;

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  buffer = new TranscriptBuffer({
    send: (key, text) => sent.push([key, text]),
    flushMs: 2000,
    runId: 'run',
  });
});
afterEach(() => vi.useRealTimers());

describe('TranscriptBuffer', () => {
  it('sends what came in after the flush interval, with numbered keys', () => {
    buffer.append('PS> ');
    buffer.append('dir\r\n');
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(2000);
    buffer.append('more');
    buffer.flush();
    expect(sent).toEqual([
      ['run:1', 'PS> dir\r\n'],
      ['run:2', 'more'],
    ]);
  });

  it('sends a full chunk at once and splits big output', () => {
    buffer.append('x'.repeat(MAX_TRANSCRIPT_CHUNK * 2 + 5));
    expect(sent.map(([, t]) => t.length)).toEqual([MAX_TRANSCRIPT_CHUNK, MAX_TRANSCRIPT_CHUNK, 5]);
  });

  it('does not split a surrogate pair', () => {
    buffer.append(`${'x'.repeat(MAX_TRANSCRIPT_CHUNK - 1)}😀`);
    buffer.flush();
    expect(sent.map(([, t]) => t.length)).toEqual([MAX_TRANSCRIPT_CHUNK - 1, 2]);
  });

  it('stops sending past the cap', () => {
    const big = 'y'.repeat(MAX_TRANSCRIPT_CHUNK);
    for (let i = 0; i < 100; i += 1) buffer.append(big);
    const total = sent.reduce((n, [, t]) => n + t.length, 0);
    expect(total).toBeGreaterThanOrEqual(MAX_TRANSCRIPT_SENT);
    expect(total).toBeLessThan(MAX_TRANSCRIPT_SENT + MAX_TRANSCRIPT_CHUNK);
    const count = sent.length;
    buffer.append('late');
    buffer.flush();
    expect(sent).toHaveLength(count);
  });
});

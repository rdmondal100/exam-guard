import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerSave, EventReport, TranscriptChunk } from '@examguard/shared';
import { OfflineQueue, queueKey } from './offline-queue.js';
import type { SecretBox } from './secret-box.js';

const box: SecretBox = {
  encrypt: (text) => Buffer.from(`enc:${text}`).toString('base64'),
  decrypt: (text) => {
    const plain = Buffer.from(text, 'base64').toString('utf8');
    return plain.startsWith('enc:') ? plain.slice(4) : null;
  },
};

let dir: string;
let file: string;
let log: ReturnType<typeof vi.fn<(message: string) => void>>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-queue-'));
  file = join(dir, 'queue', 's1.jsonl');
  log = vi.fn<(message: string) => void>();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const open = (b: SecretBox = box) => new OfflineQueue(file, b, log);

const save = (clientSeq: number, content = `v${clientSeq}`): AnswerSave => ({
  t: 'answer.save',
  id: `id${clientSeq}`,
  clientSeq,
  clientTs: 1000 + clientSeq,
  questionId: 'q1',
  language: 'c',
  content,
  selected: true,
  reason: 'interval',
});
const event: EventReport = {
  t: 'event',
  id: 'ev1',
  dedupeKey: 'ev1',
  clientTs: 5,
  type: 'run_executed',
  details: { language: 'c' },
};
const chunk: TranscriptChunk = { t: 'transcript', key: 'k1', clientTs: 6, text: 'dir\r\n' };

describe('OfflineQueue', () => {
  it('returns what was added, in order, after a restart', () => {
    const q = open();
    q.add(save(1));
    q.add(event);
    q.add(chunk);
    q.add(save(2));
    expect(open().load()).toEqual([save(1), event, chunk, save(2)]);
  });

  it('drops a frame once it is acked', () => {
    const q = open();
    q.add(save(1));
    q.add(save(2));
    q.add(save(3));
    q.remove(queueKey(save(2)));
    expect(open().load().map(queueKey)).toEqual(['s1', 's3']);
  });

  it('removes the file when the last frame is acked', () => {
    const q = open();
    q.add(save(1));
    expect(existsSync(file)).toBe(true);
    q.remove('s1');
    expect(existsSync(file)).toBe(false);
    expect(open().load()).toEqual([]);
  });

  it('keeps the content encrypted on disk', () => {
    open().add(save(1, 'secret answer text'));
    expect(readFileSync(file, 'utf8')).not.toContain('secret answer text');
  });

  it('skips a corrupt line and one it cannot decrypt, and keeps the rest', () => {
    const q = open();
    q.add(save(1));
    appendFileSync(file, 'not-base64-json\n');
    appendFileSync(file, `${Buffer.from('plain text, never encrypted').toString('base64')}\n`);
    appendFileSync(file, `${box.encrypt('{"t":"nope"}')}\n`);
    q.add(save(2));
    expect(open().load().map(queueKey)).toEqual(['s1', 's2']);
  });

  it('does not bring back a frame acked before a restart even if it was added again later', () => {
    const q = open();
    q.add(save(1));
    q.add(save(2));
    q.remove('s1');
    q.add(save(3));
    expect(open().load().map(queueKey)).toEqual(['s2', 's3']);
  });

  it('compacts the file when acked lines pile up', () => {
    const q = open();
    q.add(save(1000, 'x'.repeat(10)));
    for (let i = 1; i <= 150; i++) {
      q.add(save(i));
      q.remove(`s${i}`);
    }
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    expect(lines.length).toBeLessThan(150);
    expect(open().load().map(queueKey)).toEqual(['s1000']);
  });

  it('forgets an unknown key quietly', () => {
    const q = open();
    q.add(save(1));
    q.remove('s99');
    expect(readFileSync(file, 'utf8').split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('writes nothing when encryption is not available, and says so once', () => {
    const q = open({ encrypt: () => null, decrypt: () => null });
    q.add(save(1));
    q.add(save(2));
    expect(existsSync(file)).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('never throws when the disk refuses the write', () => {
    // A file where the folder should be makes every write fail.
    writeFileSync(join(dir, 'queue'), 'in the way');
    const q = open();
    expect(() => q.add(save(1))).not.toThrow();
    expect(() => q.remove('s1')).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('writes nothing more after clear()', () => {
    const q = open();
    q.add(save(1));
    q.clear();
    q.add(save(2));
    expect(existsSync(file)).toBe(false);
    expect(open().load()).toEqual([]);
  });
});

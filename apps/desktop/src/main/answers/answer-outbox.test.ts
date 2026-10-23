import { describe, expect, it } from 'vitest';
import type { AnswerSaveRequest, AnswerStatus } from '@examguard/shared';
import { AnswerOutbox } from './answer-outbox.js';

const request = (content: string): AnswerSaveRequest => ({
  questionId: 'q1',
  language: 'c',
  content,
  selected: true,
  reason: 'interval',
});

describe('AnswerOutbox', () => {
  it('numbers saves 1, 2, 3 and stamps them with the time it is given', () => {
    const outbox = new AnswerOutbox();
    const a = outbox.add(request('a'), 1000);
    const b = outbox.add(request('b'), 2000);
    expect([a.clientSeq, b.clientSeq]).toEqual([1, 2]);
    expect(b.clientTs).toBe(2000);
    expect(a.id).not.toBe(b.id);
  });

  it('keeps a save until it is acked, and reports the count', () => {
    const seen: AnswerStatus[] = [];
    const outbox = new AnswerOutbox((s) => seen.push(s));
    outbox.add(request('a'), 1);
    outbox.add(request('b'), 1);
    outbox.ack(1, 50);
    expect(outbox.unacked().map((s) => s.content)).toEqual(['b']);
    expect(seen.map((s) => s.pending)).toEqual([1, 2, 1]);
    expect(outbox.status()).toEqual({ pending: 1, lastAckAt: 50 });
  });

  it('ignores an ack it does not know, such as a repeated one', () => {
    const seen: AnswerStatus[] = [];
    const outbox = new AnswerOutbox((s) => seen.push(s));
    outbox.add(request('a'), 1);
    outbox.ack(1, 10);
    outbox.ack(1, 20);
    expect(outbox.status().lastAckAt).toBe(10);
    expect(seen).toHaveLength(2);
  });

  it('continues after the newest number the server holds, and never goes back', () => {
    const outbox = new AnswerOutbox();
    outbox.continueAfter([
      { questionId: 'q1', language: 'c', clientSeq: 7, selected: true },
      { questionId: 'q2', language: 'text', clientSeq: 4, selected: true },
    ]);
    expect(outbox.add(request('a'), 1).clientSeq).toBe(8);
    outbox.continueAfter([{ questionId: 'q1', language: 'c', clientSeq: 2, selected: true }]);
    expect(outbox.add(request('b'), 1).clientSeq).toBe(9);
  });

  it('drops the oldest unacked save past the cap', () => {
    const outbox = new AnswerOutbox(() => {}, 3);
    for (const c of ['a', 'b', 'c', 'd']) outbox.add(request(c), 1);
    expect(outbox.unacked().map((s) => s.content)).toEqual(['b', 'c', 'd']);
  });

  it('restores saves from disk, keeps them in order and numbers the next one after them', () => {
    const seen: AnswerStatus[] = [];
    const outbox = new AnswerOutbox((st) => seen.push(st));
    const donor = new AnswerOutbox();
    const first = donor.add(request('a'), 1);
    const second = donor.add(request('b'), 2);
    const third = donor.add(request('c'), 3);
    outbox.restore([third, first, second]);
    expect(outbox.unacked().map((x) => x.content)).toEqual(['a', 'b', 'c']);
    expect(seen.at(-1)?.pending).toBe(3);
    expect(outbox.add(request('d'), 4).clientSeq).toBe(4);
  });

  it('tells the owner which save the cap pushed out', () => {
    const dropped: number[] = [];
    const outbox = new AnswerOutbox(
      () => {},
      2,
      (save) => dropped.push(save.clientSeq),
    );
    for (const c of ['a', 'b', 'c', 'd']) outbox.add(request(c), 1);
    expect(dropped).toEqual([1, 2]);
  });
});

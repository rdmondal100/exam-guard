import { describe, expect, it } from 'vitest';
import type { AnswerSave, AnswerSnapshot } from '@examguard/shared';
import { mergeRestore } from './restore-merge.js';

const save = (clientSeq: number, over: Partial<AnswerSave> = {}): AnswerSave => ({
  t: 'answer.save',
  id: `id${clientSeq}`,
  clientSeq,
  clientTs: clientSeq,
  questionId: 'q1',
  language: 'c',
  content: `local${clientSeq}`,
  selected: true,
  reason: 'interval',
  ...over,
});

const server: AnswerSnapshot = {
  buffers: [
    { questionId: 'q1', language: 'c', content: 'srv-c', flags: '-lm', clientSeq: 5 },
    { questionId: 'q1', language: 'cpp', content: 'srv-cpp', flags: null, clientSeq: 4 },
    { questionId: 'q2', language: 'text', content: 'LIFO', flags: null, clientSeq: 3 },
  ],
  selected: [
    { questionId: 'q1', language: 'c', clientSeq: 5 },
    { questionId: 'q2', language: 'text', clientSeq: 3 },
  ],
};

describe('mergeRestore', () => {
  it('uses the server snapshot alone when nothing is unacked', () => {
    expect(mergeRestore(server, [])).toEqual({
      buffers: [
        { questionId: 'q1', language: 'c', content: 'srv-c', flags: '-lm' },
        { questionId: 'q1', language: 'cpp', content: 'srv-cpp', flags: '' },
        { questionId: 'q2', language: 'text', content: 'LIFO', flags: '' },
      ],
      languages: [
        { questionId: 'q1', language: 'c' },
        { questionId: 'q2', language: 'text' },
      ],
    });
  });

  it('lets a newer unacked save win over the server version of the same buffer', () => {
    const merged = mergeRestore(server, [save(6, { content: 'newer', flags: '-O2' })]);
    expect(merged.buffers.find((b) => b.language === 'c')).toEqual({
      questionId: 'q1',
      language: 'c',
      content: 'newer',
      flags: '-O2',
    });
  });

  it('ignores an unacked save the server already has a newer version of', () => {
    const merged = mergeRestore(server, [save(2, { content: 'stale' })]);
    expect(merged.buffers.find((b) => b.language === 'c')?.content).toBe('srv-c');
  });

  it('follows an unacked language switch', () => {
    const merged = mergeRestore(server, [
      save(6, { language: 'cpp', content: 'switched', reason: 'switch_language' }),
    ]);
    expect(merged.languages).toContainEqual({ questionId: 'q1', language: 'cpp' });
    expect(merged.languages).not.toContainEqual({ questionId: 'q1', language: 'c' });
  });

  it('does not move the selection for a save that was not the selected language', () => {
    const merged = mergeRestore(server, [save(6, { language: 'cpp', selected: false })]);
    expect(merged.languages).toContainEqual({ questionId: 'q1', language: 'c' });
  });

  it('works from local saves alone (the server was not asked)', () => {
    expect(mergeRestore(null, [save(1), save(2, { content: 'second' })])).toEqual({
      buffers: [{ questionId: 'q1', language: 'c', content: 'second', flags: '' }],
      languages: [{ questionId: 'q1', language: 'c' }],
    });
  });
});

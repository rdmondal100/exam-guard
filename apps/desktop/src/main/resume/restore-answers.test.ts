import { describe, expect, it } from 'vitest';
import type { AnswerSave, AnswerSnapshot } from '@examguard/shared';
import { restoreAnswers } from './restore-answers.js';

const save = (clientSeq: number): AnswerSave => ({
  t: 'answer.save',
  id: `id${clientSeq}`,
  clientSeq,
  clientTs: clientSeq,
  questionId: 'q1',
  language: 'c',
  content: `local${clientSeq}`,
  selected: true,
  reason: 'interval',
});

const server: AnswerSnapshot = {
  buffers: [
    { questionId: 'q1', language: 'c', content: 'srv-c', flags: '-lm', clientSeq: 5 },
    { questionId: 'q1', language: 'cpp', content: 'srv-cpp', flags: null, clientSeq: 4 },
    { questionId: 'q2', language: 'text', content: 'LIFO', flags: null, clientSeq: 3 },
  ],
  selected: [{ questionId: 'q1', language: 'c', clientSeq: 5 }],
};

describe('restoreAnswers', () => {
  it('asks the server only when its welcome said it holds versions', async () => {
    let asked = 0;
    const deps = (has: boolean) => ({
      unacked: () => [save(1)],
      serverHasAnswers: () => has,
      fetchSnapshot: async () => {
        asked += 1;
        return server;
      },
    });
    const fresh = await restoreAnswers(deps(false));
    expect(asked).toBe(0);
    expect(fresh.ok && fresh.answers.buffers).toHaveLength(1);
    const resumed = await restoreAnswers(deps(true));
    expect(asked).toBe(1);
    expect(resumed.ok && resumed.answers.buffers).toHaveLength(3);
  });

  it('fails instead of returning an empty answer when the server cannot be reached', async () => {
    const result = await restoreAnswers({
      unacked: () => [],
      serverHasAnswers: () => true,
      fetchSnapshot: async () => {
        throw new Error('the teacher computer cannot be reached');
      },
    });
    expect(result).toEqual({
      ok: false,
      message: 'Could not load your saved work: the teacher computer cannot be reached',
    });
  });
});

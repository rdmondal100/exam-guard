import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RestoreResult, RestoredAnswers } from '@examguard/shared';
import { useAnswerStore } from './answerStore';
import { restoreIntoStore } from './restoreAnswers';

const state = () => useAnswerStore.getState();
const restored: RestoredAnswers = {
  buffers: [{ questionId: 'q1', language: 'c', content: 'int x;', flags: '' }],
  languages: [{ questionId: 'q1', language: 'c' }],
};

beforeEach(() => state().reset());

describe('restoreIntoStore', () => {
  it('fills the store and seeds the autosaver', async () => {
    const seed = vi.fn();
    const result = await restoreIntoStore(
      async () => ({ ok: true, answers: restored }) satisfies RestoreResult,
      state,
      seed,
    );
    expect(result).toEqual({ ok: true });
    expect(state().answers.q1?.c).toBe('int x;');
    expect(seed).toHaveBeenCalledWith(restored);
  });

  it('reports a failure and leaves the store empty so the screen can wait and retry', async () => {
    const seed = vi.fn();
    const failed = await restoreIntoStore(
      async () => ({ ok: false, message: 'offline' }),
      state,
      seed,
    );
    expect(failed).toEqual({ ok: false, message: 'offline' });
    const thrown = await restoreIntoStore(
      async () => {
        throw new Error('ipc closed');
      },
      state,
      seed,
    );
    expect(thrown.ok).toBe(false);
    expect(state().answers).toEqual({});
    expect(seed).not.toHaveBeenCalled();
  });

  it('does nothing when the student has already typed in this run', async () => {
    state().setAnswer('q1', 'c', 'newer than anything restored');
    const fetchRestore = vi.fn();
    const result = await restoreIntoStore(fetchRestore, state, vi.fn());
    expect(result).toEqual({ ok: true });
    expect(fetchRestore).not.toHaveBeenCalled();
    expect(state().answers.q1?.c).toBe('newer than anything restored');
  });
});

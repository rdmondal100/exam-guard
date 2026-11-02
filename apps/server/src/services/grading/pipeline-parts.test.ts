import { describe, expect, it } from 'vitest';
import { runPool } from './pool.js';
import { SyntheticProvider } from './providers/synthetic.js';
import { ProviderError } from './provider.js';
import { loadFixtures } from './providers/fake.js';
import { validateGrade } from './validate.js';
import { abortableSleep } from './sleep.js';

describe('runPool', () => {
  it('never runs more than the limit at once and finishes every item', async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      done.push(n);
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('stops taking items after a failure or an abort', async () => {
    const seen: number[] = [];
    await expect(
      runPool([1, 2, 3, 4], 1, (n) => {
        seen.push(n);
        return n === 2 ? Promise.reject(new Error('boom')) : Promise.resolve();
      }),
    ).rejects.toThrow('boom');
    expect(seen).toEqual([1, 2]);
    const controller = new AbortController();
    const later: number[] = [];
    await runPool(
      [1, 2, 3],
      1,
      (n) => {
        later.push(n);
        controller.abort();
        return Promise.resolve();
      },
      controller.signal,
    );
    expect(later).toEqual([1]);
  });
});

describe('abortableSleep', () => {
  it('rejects when aborted', async () => {
    const controller = new AbortController();
    const sleeping = abortableSleep(10_000, controller.signal);
    controller.abort(new Error('stop'));
    await expect(sleeping).rejects.toThrow('stop');
  });
});

describe('SyntheticProvider (dev grader)', () => {
  const input = [...loadFixtures().values()][0]?.input;
  if (!input) throw new Error('no fixture');
  const guide = input.question.criteria;

  it('gives valid, stable grades within the guide, after at most one bad first reply', async () => {
    const replies: string[] = [];
    for (const anonId of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const grader = new SyntheticProvider(0);
      let text: string | null = null;
      for (let attempt = 0; attempt < 2 && text === null; attempt++) {
        try {
          const reply = await grader.gradeAnswer({ ...input, anonId });
          if (validateGrade(reply.text, guide).ok) text = reply.text;
        } catch (err) {
          expect(err).toBeInstanceOf(ProviderError);
        }
      }
      expect(text).not.toBeNull();
      replies.push(text ?? '');
    }
    const again = new SyntheticProvider(0);
    await again.gradeAnswer({ ...input, anonId: 'a' }).catch(() => undefined);
    const second = await again.gradeAnswer({ ...input, anonId: 'a' });
    expect(second.text).toBe(replies[0]);
  });

  it('gives zero to an empty answer', async () => {
    const reply = await new SyntheticProvider(0).gradeAnswer({
      ...input,
      anonId: 'z',
      answer: { language: 'c', content: '  ' },
    });
    const check = validateGrade(reply.text, guide);
    expect(check.ok && check.grade.total).toBe(0);
  });
});

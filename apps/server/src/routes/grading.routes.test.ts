import { afterEach, describe, expect, it } from 'vitest';
import { GradingStatusSchema } from '@examguard/shared';
import { FakeProvider, loadFixtures } from '../services/grading/providers/fake.js';
import type { GradingInput, GradingOptions, ProviderResult } from '../services/grading/provider.js';
import { fixedSource } from '../services/grading/provider-source.js';
import { gradingExam, openApp, type GradingExam } from '../testing/gradingExam.js';

const fixtures = loadFixtures();
const validText = (() => {
  const step = fixtures.get('valid-c')?.responses[0];
  return step && 'text' in step ? step.text : '';
})();

let exam: GradingExam | null = null;
afterEach(async () => {
  await exam?.close();
  exam = null;
});

const fromFixtures = () => FakeProvider.fromFixtures(fixtures.values());
const options = (provider: FakeProvider) => ({ source: fixedSource(provider), backoffMs: 0 });

/** While `hold` is on, `slow` never answers (until the signal aborts); the rest as scripted. */
class SlowFake extends FakeProvider {
  hold = true;
  override gradeAnswer(input: GradingInput, opts: GradingOptions = {}): Promise<ProviderResult> {
    if (input.anonId !== 'slow' || !this.hold) return super.gradeAnswer(input, opts);
    this.calls.push({ input, options: opts });
    return new Promise((_, reject) =>
      opts.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
    );
  }
}

const status = async (e: GradingExam) =>
  GradingStatusSchema.parse((await e.call('GET', `/exams/${e.examId}/grading`)).json());

describe('grading pipeline (M38)', () => {
  it('retries 429s and invalid replies, flags what never validates, then goes to review', async () => {
    const fake = fromFixtures();
    const anon = ['anon-valid', 'anon-429', 'anon-garbage', 'anon-overmax', 'anon-empty'];
    const e = (exam = await gradingExam(anon, options(fake)));
    const started = await e.call('POST', `/exams/${e.examId}/grading`);
    expect(started.statusCode).toBe(200);
    expect(started.json().examState).toBe('grading');
    await e.app.grading.idle(e.examId);

    const s = await status(e);
    expect(s.examState).toBe('in_review');
    expect(s.provider).toBe('fake');
    expect(s.jobs).toMatchObject([{ state: 'done', total: 5, done: 4, failed: 1 }]);
    expect(s.questions[0]).toMatchObject({ answers: 5, aiGraded: 4, needsManual: 1, pending: 0 });

    const detail = async (a: string) =>
      (await e.call('GET', `/answers/${e.students.get(a)}/${e.questionId}`)).json();
    const limited = await detail('anon-429');
    expect(limited.history.map((h: { status: string }) => h.status)).toEqual([
      'error',
      'error',
      'ok',
    ]);
    expect(limited.grade).toMatchObject({ status: 'ai_graded', total: 7, confidence: 'high' });
    expect(limited.current.criteria[0]).toMatchObject({ name: 'Correct logic', awarded: 4.5 });

    const garbage = await detail('anon-garbage');
    expect(garbage.grade.status).toBe('needs_manual');
    expect(garbage.current).toBeNull();
    expect(garbage.history).toHaveLength(3);
    expect(garbage.history[0].problems).toEqual(['The reply is not valid JSON.']);

    const overMax = await detail('anon-overmax');
    expect(overMax.history.map((h: { status: string }) => h.status)).toEqual(['invalid', 'ok']);
    const repaired = fake.calls.filter((c) => c.input.anonId === 'anon-overmax');
    expect(repaired[1]?.options.repairHint).toMatch(/outside 0 to/);
    // Only the anonymous id leaves the server, never the name or the student code.
    expect(JSON.stringify(fake.calls.map((c) => c.input))).not.toMatch(/Student \d/);

    // From review, a new run retries only what is left: the answer that needs manual grading.
    const before = fake.calls.length;
    expect((await e.call('POST', `/exams/${e.examId}/grading`)).statusCode).toBe(200);
    await e.app.grading.idle(e.examId);
    expect(new Set(fake.calls.slice(before).map((c) => c.input.anonId))).toEqual(
      new Set(['anon-garbage']),
    );
    expect((await status(e)).questions[0]).toMatchObject({ aiGraded: 4, needsManual: 1 });
  });

  it('a refused key stops the run; the answers stay pending', async () => {
    const fake = new FakeProvider({
      a: [{ error: { kind: 'auth', status: 401, message: 'API key not valid' } }],
      b: [{ text: validText }],
    });
    const e = (exam = await gradingExam(['a', 'b'], { ...options(fake), concurrency: 1 }));
    await e.call('POST', `/exams/${e.examId}/grading`);
    await e.app.grading.idle(e.examId);
    const s = await status(e);
    expect(s.examState).toBe('in_review');
    expect(s.jobs[0]).toMatchObject({ state: 'failed' });
    expect(s.jobs[0]?.error).toMatch(/API key not valid/);
    expect(s.questions[0]).toMatchObject({ pending: 2 });
  });

  it('resumes an unfinished job after a restart without grading answers twice', async () => {
    const first = new SlowFake({ a: [{ text: validText }] });
    const e = (exam = await gradingExam(['a', 'slow'], { ...options(first), concurrency: 1 }));
    await e.call('POST', `/exams/${e.examId}/grading`);
    await expect.poll(() => first.calls.length).toBe(2);
    e.app.grading.dispose(); // the server process dies mid-job
    await e.app.grading.idle(e.examId);
    expect((await status(e)).jobs[0]).toMatchObject({ state: 'running', done: 1 });

    const second = new FakeProvider({ slow: [{ text: validText }] });
    const restarted = openApp(e.dir, e.db, options(second));
    try {
      await restarted.grading.resume();
      await restarted.grading.idle(e.examId);
      expect(second.calls.map((c) => c.input.anonId)).toEqual(['slow']);
      const s = restarted.grading.status(e.examId);
      expect(s?.examState).toBe('in_review');
      expect(s?.jobs[0]).toMatchObject({ state: 'done', done: 2, failed: 0 });
    } finally {
      restarted.grading.dispose();
    }
  });

  it('cancel stops grading and keeps the rest pending; a new run grades only what is left', async () => {
    const fake = new SlowFake({ a: [{ text: validText }] });
    const e = (exam = await gradingExam(['a', 'slow'], { ...options(fake), concurrency: 2 }));
    await e.call('POST', `/exams/${e.examId}/grading`);
    await expect.poll(() => fake.calls.length).toBe(2);
    const twice = await e.call('POST', `/exams/${e.examId}/grading`);
    expect(twice.json().error.code).toBe('invalid_state');
    const cancelled = await e.call('POST', `/exams/${e.examId}/grading/cancel`);
    expect(cancelled.json()).toMatchObject({
      examState: 'in_review',
      jobs: [{ state: 'cancelled' }],
    });
    await e.app.grading.idle(e.examId);
    expect((await status(e)).questions[0]).toMatchObject({ aiGraded: 1, pending: 1 });

    fake.script('slow', [{ text: validText }]);
    fake.hold = false;
    await e.call('POST', `/exams/${e.examId}/grading`);
    await e.app.grading.idle(e.examId);
    expect(fake.calls.slice(2).map((c) => c.input.anonId)).toEqual(['slow']);
    expect((await status(e)).questions[0]).toMatchObject({ aiGraded: 2, pending: 0 });
    expect((await e.call('POST', `/exams/${e.examId}/grading`)).json().error.code).toBe(
      'nothing_to_grade',
    );
  });

  it('refuses exams that have not ended and asks for a key when there is none', async () => {
    const e = (exam = await gradingExam(['a']));
    const noKey = await e.call('POST', `/exams/${e.examId}/grading`);
    expect(noKey.statusCode).toBe(422);
    expect(noKey.json().error.code).toBe('no_api_key');
    e.db.prepare("UPDATE exams SET state = 'running' WHERE id = ?").run(e.examId);
    expect((await e.call('POST', `/exams/${e.examId}/grading`)).statusCode).toBe(409);
    expect((await e.call('GET', '/exams/nope/grading')).statusCode).toBe(404);
    expect(
      (await e.call('POST', `/exams/${e.examId}/grading`, { questionIds: [] })).statusCode,
    ).toBe(400);
  });
});

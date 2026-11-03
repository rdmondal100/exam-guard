import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnswerDetailSchema, GradingStatusSchema } from '@examguard/shared';
import { FakeProvider } from '../services/grading/providers/fake.js';
import type { GradingInput, GradingOptions, ProviderResult } from '../services/grading/provider.js';
import { fixedSource } from '../services/grading/provider-source.js';
import { gradingExam, openApp, type GradingExam } from '../testing/gradingExam.js';

/** A valid reply for the fixtures' question (max 5 / 2 / 1) with the given marks. */
const reply = (logic: number, loop: number, style: number, confidence = 'high') => ({
  text: JSON.stringify({
    criteria: [
      { name: 'Correct logic', max: 5, awarded: logic, reason: 'r' },
      { name: 'Uses a loop', max: 2, awarded: loop, reason: 'r' },
      { name: 'Code style', max: 1, awarded: style, reason: 'r' },
    ],
    total: logic + loop + style,
    feedback: 'f',
    teacher_notes: [],
    confidence,
  }),
});

/** While `hold` is on, every call waits until its signal aborts. */
class HoldingFake extends FakeProvider {
  hold = false;
  override gradeAnswer(input: GradingInput, opts: GradingOptions = {}): Promise<ProviderResult> {
    if (!this.hold) return super.gradeAnswer(input, opts);
    this.calls.push({ input, options: opts });
    return new Promise((_, reject) =>
      opts.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
    );
  }
}

const INSTRUCTION = 'Also accept recursive solutions.';
let e: GradingExam;
let fake: HoldingFake;

beforeEach(async () => {
  fake = new HoldingFake({
    a: [reply(2, 0, 1), reply(5, 2, 1)],
    b: [reply(2, 0, 1), reply(5, 2, 1)],
    c: [reply(2, 0, 1), reply(5, 2, 1)],
  });
  e = await gradingExam(['a', 'b', 'c'], { source: fixedSource(fake), backoffMs: 0 });
  await e.call('POST', `/exams/${e.examId}/grading`);
  await e.app.grading.idle(e.examId);
  // a: accepted (verified), b: edited (modified), c: left as the AI graded it.
  await e.call('POST', `/answers/${sid('a')}/${e.questionId}/accept`);
  await e.call('POST', `/answers/${sid('b')}/${e.questionId}/edit`, {
    criteria: [
      { name: 'Correct logic', awarded: 3 },
      { name: 'Uses a loop', awarded: 0 },
      { name: 'Code style', awarded: 1 },
    ],
    feedback: 'Teacher feedback',
  });
});
afterEach(() => e.close());

const sid = (anon: string) => e.students.get(anon) ?? '';
const detail = async (anon: string) =>
  AnswerDetailSchema.parse((await e.call('GET', `/answers/${sid(anon)}/${e.questionId}`)).json());
const reevaluate = (body: object) =>
  e.call('POST', `/exams/${e.examId}/grading/reevaluate`, {
    questionId: e.questionId,
    instruction: INSTRUCTION,
    ...body,
  });

describe('re-evaluate with an instruction (M41)', () => {
  it('all students: only unedited answers change, with the instruction in the prompt', async () => {
    const before = fake.calls.length;
    const res = await reevaluate({ examStudentIds: 'all' });
    expect(res.statusCode).toBe(200);
    const started = GradingStatusSchema.parse(res.json());
    expect(started.examState).toBe('grading');
    expect(started.jobs[0]).toMatchObject({ kind: 'reevaluate', total: 1 });
    await e.app.grading.idle(e.examId);

    const calls = fake.calls.slice(before);
    expect(calls.map((c) => c.input.anonId)).toEqual(['c']);
    expect(calls[0]?.options.instruction).toBe(INSTRUCTION);
    const c = await detail('c');
    expect(c.grade).toMatchObject({ status: 'ai_graded', total: 8 });
    expect(c.history.map((h) => [h.author, h.total, h.instruction])).toEqual([
      ['ai', 3, null],
      ['ai', 8, INSTRUCTION],
    ]);
    expect((await detail('a')).grade).toMatchObject({ status: 'verified', total: 3 });
    expect((await detail('b')).grade).toMatchObject({ status: 'modified', total: 4 });
    expect(
      GradingStatusSchema.parse((await e.call('GET', `/exams/${e.examId}/grading`)).json()),
    ).toMatchObject({ examState: 'in_review', jobs: [{ kind: 'reevaluate', state: 'done' }] });
  });

  it('one student, edited answers included: the teacher grade is replaced and kept in history', async () => {
    const res = await reevaluate({ examStudentIds: [sid('b')], includeEdited: true });
    expect(res.statusCode).toBe(200);
    await e.app.grading.idle(e.examId);
    const b = await detail('b');
    expect(b.grade).toMatchObject({ status: 'ai_graded', total: 8 });
    expect(b.history.map((h) => h.author)).toEqual(['ai', 'teacher', 'ai']);
    expect((await detail('c')).grade.total).toBe(3);
  });

  it('refuses edited-only scopes, unknown students, bad bodies and other states', async () => {
    const edited = await reevaluate({ examStudentIds: [sid('a'), sid('b')] });
    expect(edited.statusCode).toBe(409);
    expect(edited.json().error.code).toBe('nothing_to_grade');
    expect((await reevaluate({ examStudentIds: ['nobody'] })).json().error.code).toBe(
      'unknown_student',
    );
    expect((await reevaluate({ examStudentIds: 'all', instruction: '  ' })).statusCode).toBe(400);
    expect(
      (await reevaluate({ examStudentIds: 'all', questionId: 'nope' })).json().error.code,
    ).toBe('unknown_question');
    e.db.prepare("UPDATE exams SET state = 'finalized' WHERE id = ?").run(e.examId);
    expect((await reevaluate({ examStudentIds: 'all' })).json().error.code).toBe('invalid_state');
  });

  it('a cancelled re-evaluation keeps the old grade', async () => {
    fake.hold = true;
    await reevaluate({ examStudentIds: 'all', includeEdited: true });
    await expect.poll(() => fake.calls.length).toBeGreaterThan(3);
    const cancelled = await e.call('POST', `/exams/${e.examId}/grading/cancel`);
    expect(cancelled.json().examState).toBe('in_review');
    await e.app.grading.idle(e.examId);
    expect((await detail('a')).grade).toMatchObject({ status: 'verified', total: 3 });
    expect((await detail('c')).grade).toMatchObject({ status: 'ai_graded', total: 3 });
    // Nothing is left queued: a later run of "the rest" has nothing to do.
    expect((await e.call('POST', `/exams/${e.examId}/grading`)).json().error.code).toBe(
      'nothing_to_grade',
    );
  });

  it('resumes a re-evaluation after a restart without grading answers twice', async () => {
    fake.hold = true;
    await reevaluate({ examStudentIds: 'all', includeEdited: true });
    await expect.poll(() => fake.calls.length).toBeGreaterThan(3);
    e.app.grading.dispose(); // the server dies mid-job
    await e.app.grading.idle(e.examId);

    const second = new FakeProvider({
      a: [reply(4, 2, 1)],
      b: [reply(4, 2, 1)],
      c: [reply(4, 2, 1)],
    });
    const restarted = openApp(e.dir, e.db, { source: fixedSource(second), backoffMs: 0 });
    try {
      await restarted.grading.resume();
      await restarted.grading.idle(e.examId);
      expect(second.calls.map((c) => c.input.anonId).sort()).toEqual(['a', 'b', 'c']);
      expect(second.calls[0]?.options.instruction).toBe(INSTRUCTION);
      expect(restarted.grading.status(e.examId)?.examState).toBe('in_review');
      expect((await detail('a')).grade).toMatchObject({ status: 'ai_graded', total: 7 });
    } finally {
      restarted.grading.dispose();
    }
  });
});

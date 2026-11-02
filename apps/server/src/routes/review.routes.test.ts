import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnswerDetailSchema, ReviewTableSchema } from '@examguard/shared';
import { FakeProvider, loadFixtures } from '../services/grading/providers/fake.js';
import { fixedSource } from '../services/grading/provider-source.js';
import { gradingExam, type GradingExam } from '../testing/gradingExam.js';

const ANON = ['anon-valid', 'anon-garbage', 'anon-empty'];
let e: GradingExam;

beforeEach(async () => {
  const fake = FakeProvider.fromFixtures(loadFixtures().values());
  e = await gradingExam(ANON, { source: fixedSource(fake), backoffMs: 0 });
  await e.call('POST', `/exams/${e.examId}/grading`);
  await e.app.grading.idle(e.examId);
});
afterEach(() => e.close());

const sid = (anon: string) => e.students.get(anon) ?? '';
const answerUrl = (anon: string) => `/answers/${sid(anon)}/${e.questionId}`;
const detail = async (anon: string) =>
  AnswerDetailSchema.parse((await e.call('GET', answerUrl(anon))).json());
const fullMarks = [
  { name: 'Correct logic', awarded: 5, reason: 'Right' },
  { name: 'uses  a LOOP', awarded: 2 },
  { name: 'Code style', awarded: 0.5 },
];

describe('review screens (M39)', () => {
  it('lists every answer of a question with status, total and confidence', async () => {
    const res = await e.call('GET', `/exams/${e.examId}/review/${e.questionId}`);
    const table = ReviewTableSchema.parse(res.json());
    expect(table).toMatchObject({ position: 1, marks: 8 });
    expect(table.rows.map((r) => [r.studentCode, r.status])).toEqual([
      ['1', 'ai_graded'],
      ['2', 'needs_manual'],
      ['3', 'ai_graded'],
    ]);
    expect(table.rows[0]).toMatchObject({ name: 'Student 1', language: 'c', empty: false });
    expect((await e.call('GET', `/exams/${e.examId}/review/nope`)).statusCode).toBe(404);
  });

  it('shows one answer with the student, the current grade and the history', async () => {
    const d = await detail('anon-valid');
    expect(d.student).toMatchObject({ id: sid('anon-valid'), studentCode: '1', name: 'Student 1' });
    expect(d.answer.language).toBe('c');
    expect(d.current?.author).toBe('ai');
    expect(d.current?.provider).toBe('fake');
    expect(d.current?.promptVersion).toBe('grade-v1');
    expect(d.current?.rawResponse).toContain('criteria');
    expect(d.history).toHaveLength(1);
    expect((await e.call('GET', `/answers/nobody/${e.questionId}`)).statusCode).toBe(404);
  });
});

describe('accept / edit + history (M40)', () => {
  it('accept verifies the AI grade and adds a teacher entry', async () => {
    const before = await detail('anon-valid');
    const res = await e.call('POST', `${answerUrl('anon-valid')}/accept`);
    expect(res.statusCode).toBe(200);
    const d = AnswerDetailSchema.parse(res.json());
    expect(d.grade).toMatchObject({ status: 'verified', total: before.grade.total });
    expect(d.history.map((h) => h.author)).toEqual(['ai', 'teacher']);
    expect(d.current?.criteria).toEqual(before.current?.criteria);
    expect((await e.call('POST', `${answerUrl('anon-valid')}/accept`)).statusCode).toBe(200);
    const flagged = await e.call('POST', `${answerUrl('anon-garbage')}/accept`);
    expect(flagged.json().error.code).toBe('nothing_to_accept');
  });

  it('edit stores the teacher marks in the guide order, refuses marks over the max', async () => {
    const over = await e.call('POST', `${answerUrl('anon-garbage')}/edit`, {
      criteria: [...fullMarks.slice(0, 2), { name: 'Code style', awarded: 1.5 }],
      feedback: 'x',
    });
    expect(over.statusCode).toBe(400);
    expect(over.json().error).toMatchObject({ code: 'invalid_marks' });
    expect(over.json().error.details.problems[0]).toMatch(/at most 1/);
    const missing = await e.call('POST', `${answerUrl('anon-garbage')}/edit`, {
      criteria: fullMarks.slice(0, 2),
      feedback: 'x',
    });
    expect(missing.json().error.details.problems).toEqual(['"Code style" is missing.']);
    const halfStep = await e.call('POST', `${answerUrl('anon-garbage')}/edit`, {
      criteria: [{ name: 'Correct logic', awarded: 0.3 }],
      feedback: '',
    });
    expect(halfStep.json().error.code).toBe('invalid_body');

    const res = await e.call('POST', `${answerUrl('anon-garbage')}/edit`, {
      criteria: [...fullMarks].reverse(),
      feedback: '  Good loop.  ',
      teacherNotes: [{ line: 2, issue: 'Name the accumulator' }],
    });
    expect(res.statusCode).toBe(200);
    const d = AnswerDetailSchema.parse(res.json());
    expect(d.grade).toMatchObject({ status: 'modified', total: 7.5, confidence: null });
    expect(d.current?.criteria.map((c) => [c.name, c.awarded, c.max])).toEqual([
      ['Correct logic', 5, 5],
      ['Uses a loop', 2, 2],
      ['Code style', 0.5, 1],
    ]);
    expect(d.current?.feedback).toBe('Good loop.');
    expect(d.history.map((h) => `${h.author}:${h.status}`)).toEqual([
      'ai:invalid',
      'ai:invalid',
      'ai:invalid',
      'teacher:ok',
    ]);
    const accept = await e.call('POST', `${answerUrl('anon-garbage')}/accept`);
    expect(accept.json().error.code).toBe('nothing_to_accept');

    const table = ReviewTableSchema.parse(
      (await e.call('GET', `/exams/${e.examId}/review/${e.questionId}`)).json(),
    );
    expect(table.rows[1]).toMatchObject({ status: 'modified', total: 7.5 });
  });

  it('refuses changes unless the exam is in review', async () => {
    e.db.prepare("UPDATE exams SET state = 'finalized' WHERE id = ?").run(e.examId);
    const res = await e.call('POST', `${answerUrl('anon-valid')}/edit`, {
      criteria: fullMarks,
      feedback: '',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/finalized/);
    expect((await e.call('POST', `${answerUrl('anon-valid')}/accept`)).statusCode).toBe(409);
  });
});

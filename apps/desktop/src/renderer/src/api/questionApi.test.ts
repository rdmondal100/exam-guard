import { describe, expect, it, vi } from 'vitest';
import { createExamApi } from './examApi';
import { createQuestionApi, readyProblemsOf } from './questionApi';
import { TeacherApiError } from './teacherApi';

const CONNECTION = { baseUrl: 'http://127.0.0.1:47821', token: 'tok' };
const QUESTION = {
  id: 'q1',
  examId: 'e1',
  position: 1,
  type: 'written',
  body: 'Explain',
  marks: 2.5,
  allowedLanguages: [],
  studentNote: '',
  sampleAnswer: 'a',
  sampleLanguage: 'text',
  aiNotes: '',
  criteria: [{ name: 'Clear', maxMarks: 2.5 }],
};
const BODY = {
  type: 'written' as const,
  body: 'Explain',
  allowedLanguages: [],
  studentNote: '',
  sampleAnswer: 'a',
  sampleLanguage: 'text',
  aiNotes: '',
  criteria: [{ name: 'Clear', maxMarks: 2.5 }],
};

function reply(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}
const lastCall = (fetchFn: typeof fetch) => vi.mocked(fetchFn).mock.calls[0] ?? [];

describe('createQuestionApi', () => {
  it('lists, creates, updates, removes and reorders on the right URLs', async () => {
    const list = reply(200, [QUESTION]);
    expect(await createQuestionApi(CONNECTION, list).list('a/b')).toHaveLength(1);
    expect(lastCall(list)[0]).toBe('http://127.0.0.1:47821/api/v1/exams/a%2Fb/questions');

    const create = reply(201, QUESTION);
    await createQuestionApi(CONNECTION, create).create('e1', BODY);
    expect(lastCall(create)[1]?.method).toBe('POST');

    const update = reply(200, QUESTION);
    await createQuestionApi(CONNECTION, update).update('q1', BODY);
    expect(lastCall(update)[0]).toBe('http://127.0.0.1:47821/api/v1/questions/q1');
    expect(lastCall(update)[1]?.method).toBe('PATCH');

    const del = reply(200, { ok: true });
    await createQuestionApi(CONNECTION, del).remove('q1');
    expect(lastCall(del)[1]?.method).toBe('DELETE');

    const order = reply(200, [QUESTION]);
    await createQuestionApi(CONNECTION, order).reorder('e1', ['q1']);
    expect(lastCall(order)[0]).toBe('http://127.0.0.1:47821/api/v1/exams/e1/questions/reorder');
    expect(lastCall(order)[1]?.body).toBe(JSON.stringify({ ids: ['q1'] }));
  });
});

describe('ready errors', () => {
  const problem = { code: 'no_questions', message: 'Add at least one question' };

  it('exposes the problems of a not_ready answer', async () => {
    const fetchFn = reply(422, {
      error: { code: 'not_ready', message: 'x', details: { problems: [problem] } },
    });
    const error = await createExamApi(CONNECTION, fetchFn)
      .markReady('e1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TeacherApiError);
    expect(readyProblemsOf(error)).toEqual([problem]);
    expect(lastCall(fetchFn)[0]).toBe('http://127.0.0.1:47821/api/v1/exams/e1/ready');
  });

  it('returns null for other errors', () => {
    expect(readyProblemsOf(new TeacherApiError(409, 'invalid_state', 'x'))).toBeNull();
    expect(readyProblemsOf(new Error('boom'))).toBeNull();
  });
});

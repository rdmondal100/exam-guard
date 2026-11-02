import { describe, expect, it, vi } from 'vitest';
import { createGradingApi } from './gradingApi';
import { TeacherApiError } from './teacherApi';

const CONNECTION = { baseUrl: 'http://127.0.0.1:47821', token: 'tok' };
const STATUS = { examId: 'e1', examState: 'grading', provider: 'fake', jobs: [], questions: [] };

function reply(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe('createGradingApi', () => {
  it('starts grading with POST and validates the status', async () => {
    const fetchFn = reply(200, STATUS);
    expect((await createGradingApi(CONNECTION, fetchFn).start('e1')).examState).toBe('grading');
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:47821/api/v1/exams/e1/grading');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}');
  });

  it('sends an edit to the answer and passes the invalid_marks problems on', async () => {
    const fetchFn = reply(400, {
      error: { code: 'invalid_marks', message: 'No', details: { problems: ['too high'] } },
    });
    const err = await createGradingApi(CONNECTION, fetchFn)
      .edit('s 1', 'q1', { criteria: [{ name: 'A', awarded: 9 }], feedback: '' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeacherApiError);
    expect(err).toMatchObject({ code: 'invalid_marks', details: { problems: ['too high'] } });
    expect(vi.mocked(fetchFn).mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:47821/api/v1/answers/s%201/q1/edit',
    );
  });
});

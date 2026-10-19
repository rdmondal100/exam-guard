import { describe, expect, it, vi } from 'vitest';
import { createExamApi } from './examApi';
import { TeacherApiError } from './teacherApi';

const CONNECTION = { baseUrl: 'http://127.0.0.1:47821', token: 'tok' };
const EXAM = {
  id: 'e1',
  title: 'Midterm',
  state: 'draft',
  durationMin: 90,
  classListId: null,
  classListName: null,
  monitoring: {
    screenshotOnSwitch: true,
    screenshotOnTitleChange: true,
    screenshotIntervalSec: 20,
    minScreenshotGapSec: 5,
    highSeverityApps: [],
    graceSec: 60,
  },
  createdAt: 1,
  updatedAt: 1,
};

function reply(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe('createExamApi', () => {
  it('lists and validates exams', async () => {
    const fetchFn = reply(200, [EXAM]);
    expect(await createExamApi(CONNECTION, fetchFn).list()).toHaveLength(1);
    expect(vi.mocked(fetchFn).mock.calls[0]?.[0]).toBe('http://127.0.0.1:47821/api/v1/exams');
  });

  it('creates with POST', async () => {
    const fetchFn = reply(201, EXAM);
    await createExamApi(CONNECTION, fetchFn).create({ title: 'Midterm', durationMin: 90 });
    const [, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ title: 'Midterm', durationMin: 90 }));
  });

  it('updates with PATCH and an encoded id', async () => {
    const fetchFn = reply(200, EXAM);
    await createExamApi(CONNECTION, fetchFn).update('a/b', { title: 'x' });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:47821/api/v1/exams/a%2Fb');
    expect(init?.method).toBe('PATCH');
  });

  it('duplicates with POST and deletes with DELETE', async () => {
    const dup = reply(201, EXAM);
    await createExamApi(CONNECTION, dup).duplicate('e1');
    expect(vi.mocked(dup).mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:47821/api/v1/exams/e1/duplicate',
    );
    const del = reply(200, { ok: true });
    await createExamApi(CONNECTION, del).remove('e1');
    expect(vi.mocked(del).mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('surfaces invalid_state as a TeacherApiError', async () => {
    const fetchFn = reply(409, { error: { code: 'invalid_state', message: 'no' } });
    const err = await createExamApi(CONNECTION, fetchFn)
      .remove('e1')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeacherApiError);
    expect(err).toMatchObject({ status: 409, code: 'invalid_state' });
  });
});

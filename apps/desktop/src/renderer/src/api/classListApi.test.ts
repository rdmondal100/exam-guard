import { describe, expect, it, vi } from 'vitest';
import { createClassListApi } from './classListApi';
import { TeacherApiError } from './teacherApi';

const CONNECTION = { baseUrl: 'http://127.0.0.1:47821', token: 'tok' };

function reply(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe('createClassListApi', () => {
  it('previews with dryRun: true', async () => {
    const fetchFn = reply(200, { rows: [{ studentCode: '1', name: 'Ada' }], errors: [] });
    const result = await createClassListApi(CONNECTION, fetchFn).preview('CSE', 'a,b');
    expect(result.rows).toHaveLength(1);
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:47821/api/v1/class-lists/import');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ name: 'CSE', csvText: 'a,b', dryRun: true }));
  });

  it('imports with dryRun: false', async () => {
    const fetchFn = reply(200, {
      list: { id: 'l1', name: 'CSE', studentCount: 1, createdAt: 1 },
      rows: [],
      errors: [],
    });
    const result = await createClassListApi(CONNECTION, fetchFn).import('CSE', 'a,b');
    expect(result.list?.id).toBe('l1');
    const [, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(init?.body).toContain('"dryRun":false');
  });

  it('deletes with the DELETE method and an encoded id', async () => {
    const fetchFn = reply(200, { ok: true });
    await createClassListApi(CONNECTION, fetchFn).remove('a/b');
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:47821/api/v1/class-lists/a%2Fb');
    expect(init?.method).toBe('DELETE');
    expect(init?.body).toBeUndefined();
  });

  it('surfaces list_in_use as a TeacherApiError', async () => {
    const fetchFn = reply(409, { error: { code: 'list_in_use', message: 'An exam uses this' } });
    const err = await createClassListApi(CONNECTION, fetchFn)
      .remove('x')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeacherApiError);
    expect(err).toMatchObject({ status: 409, code: 'list_in_use' });
  });
});

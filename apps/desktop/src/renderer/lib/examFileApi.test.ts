import { describe, expect, it, vi } from 'vitest';
import { EXAM_FILE_LIMITS } from '@examguard/shared';
import { createExamFileApi } from './examFileApi';
import { TeacherApiError } from './teacherApi';

const CONNECTION = { baseUrl: 'http://127.0.0.1:47821', token: 'tok' };
const FILE = { id: 'f1', name: 'data.csv', size: 4, sha256: 'a'.repeat(64) };

function reply(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}
const lastCall = (fetchFn: typeof fetch) => vi.mocked(fetchFn).mock.calls[0] ?? [];

describe('createExamFileApi', () => {
  it('lists and removes on the right URLs', async () => {
    const list = reply(200, [FILE]);
    expect(await createExamFileApi(CONNECTION, list).list('a/b')).toEqual([FILE]);
    expect(lastCall(list)[0]).toBe('http://127.0.0.1:47821/api/v1/exams/a%2Fb/files');

    const del = reply(200, { ok: true });
    await createExamFileApi(CONNECTION, del).remove('e1', 'f 1');
    expect(lastCall(del)[0]).toBe('http://127.0.0.1:47821/api/v1/exams/e1/files/f%201');
    expect(lastCall(del)[1]?.method).toBe('DELETE');
  });

  it('uploads the raw file with the token and the name in the query', async () => {
    const post = reply(201, FILE);
    const file = new File(['a,b'], 'my data (1).csv');
    expect(await createExamFileApi(CONNECTION, post).upload('e1', file)).toEqual(FILE);
    const [url, init] = lastCall(post);
    expect(url).toBe('http://127.0.0.1:47821/api/v1/exams/e1/files?name=my%20data%20(1).csv');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(file);
    expect(init?.headers).toMatchObject({
      'x-teacher-token': 'tok',
      'content-type': 'application/octet-stream',
    });
  });

  it('turns a server refusal into a TeacherApiError', async () => {
    const full = reply(413, { error: { code: 'exam_files_full', message: 'Too many bytes' } });
    await expect(
      createExamFileApi(CONNECTION, full).upload('e1', new File(['x'], 'a.txt')),
    ).rejects.toMatchObject({ status: 413, code: 'exam_files_full', message: 'Too many bytes' });
  });

  it('refuses a bad name or a too large file without sending anything', async () => {
    const never = reply(201, FILE);
    const api = createExamFileApi(CONNECTION, never);
    const bad = await api.upload('e1', new File(['x'], 'a:b.txt')).catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(TeacherApiError);
    expect(bad).toMatchObject({ code: 'invalid_name' });

    const big = new File(['x'], 'big.bin');
    Object.defineProperty(big, 'size', { value: EXAM_FILE_LIMITS.fileBytes + 1 });
    await expect(api.upload('e1', big)).rejects.toMatchObject({ code: 'file_too_large' });
    expect(never).not.toHaveBeenCalled();
  });
});

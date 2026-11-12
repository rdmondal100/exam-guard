import { describe, expect, it, vi } from 'vitest';
import { createAuthApi, TeacherApiError } from './teacherApi';

const CONNECTION = { baseUrl: 'http://127.0.0.1:47821', token: 'tok' };

function reply(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe('createAuthApi', () => {
  it('sends the token and parses the status', async () => {
    const fetchFn = reply(200, { setupRequired: false, loggedIn: true });
    const status = await createAuthApi(CONNECTION, fetchFn).status();
    expect(status).toEqual({ setupRequired: false, loggedIn: true });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:47821/api/v1/auth/status');
    expect((init?.headers as Record<string, string>)['x-teacher-token']).toBe('tok');
  });

  it('posts the password as JSON on login', async () => {
    const fetchFn = reply(200, { ok: true });
    await createAuthApi(CONNECTION, fetchFn).login('secret');
    const [, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ password: 'secret' }));
  });

  it('turns an error envelope into a TeacherApiError with retryAfterSec', async () => {
    const fetchFn = reply(429, {
      error: { code: 'rate_limited', message: 'slow down', details: { retryAfterSec: 30 } },
    });
    const err = await createAuthApi(CONNECTION, fetchFn)
      .login('x')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeacherApiError);
    expect(err).toMatchObject({ status: 429, code: 'rate_limited', retryAfterSec: 30 });
  });

  it('reports an unparseable error body as unknown', async () => {
    const err = await createAuthApi(CONNECTION, reply(500, 'boom'))
      .status()
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 500, code: 'unknown' });
  });
});

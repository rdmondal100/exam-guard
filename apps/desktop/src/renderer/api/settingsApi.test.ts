import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@examguard/shared';
import { createSettingsApi } from './settingsApi';

const CONNECTION = { baseUrl: 'http://127.0.0.1:47821', token: 'tok' };
const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('createSettingsApi (M43)', () => {
  it('patches a section with PATCH and validates the answer', async () => {
    const fetchFn = reply(DEFAULT_SETTINGS);
    const api = createSettingsApi(CONNECTION, fetchFn);
    await api.update({ grading: { concurrency: 2 } });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:47821/api/v1/settings');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ grading: { concurrency: 2 } });
  });

  it('changes the password and passes a refusal on', async () => {
    const fetchFn = reply({ error: { code: 'bad_password', message: 'Wrong' } }, 401);
    await expect(
      createSettingsApi(CONNECTION, fetchFn).changePassword('old', 'new password!'),
    ).rejects.toMatchObject({ code: 'bad_password' });
    expect(vi.mocked(fetchFn).mock.calls[0]?.[0]).toBe('http://127.0.0.1:47821/api/v1/auth/change');
  });
});

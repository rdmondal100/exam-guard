import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase } from '../db/database.js';
import { buildTeacherApp } from './teacher-app.js';

const TOKEN = 't'.repeat(40);
const PASSWORD = 'correct horse battery';
const HEADERS = { 'x-teacher-token': TOKEN };

let app: FastifyInstance;
let cleanup: (() => void) | undefined;
let clock = 1_000_000;

function build() {
  const dir = mkdtempSync(join(tmpdir(), 'eg-auth-'));
  const db = initDatabase(dir);
  const built = buildTeacherApp({ token: TOKEN, db, now: () => clock });
  built.app.get('/api/v1/secret', { preHandler: built.requireLogin }, async () => ({ secret: 1 }));
  app = built.app;
  cleanup = () => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  };
}

const post = (url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/auth/${url}`,
    headers: HEADERS,
    payload: payload as object,
  });
const status = async () =>
  (await app.inject({ url: '/api/v1/auth/status', headers: HEADERS })).json();

afterEach(async () => {
  await app.close();
  cleanup?.();
});

describe('auth routes', () => {
  it('reports setup required on a fresh database', async () => {
    build();
    expect(await status()).toEqual({ setupRequired: true, loggedIn: false });
  });

  it('sets the password once, logs in, and refuses a second setup', async () => {
    build();
    expect((await post('setup', { password: PASSWORD })).statusCode).toBe(200);
    expect(await status()).toEqual({ setupRequired: false, loggedIn: true });
    const again = await post('setup', { password: 'another password' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'already_setup' } });
  });

  it('rejects a short or missing setup password', async () => {
    build();
    expect((await post('setup', { password: 'short' })).statusCode).toBe(400);
    expect((await post('setup', {})).statusCode).toBe(400);
    expect((await status()).setupRequired).toBe(true);
  });

  it('refuses login before setup', async () => {
    build();
    const res = await post('login', { password: PASSWORD });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'setup_required' } });
  });

  it('logs in with the right password and rejects the wrong one', async () => {
    build();
    await post('setup', { password: PASSWORD });
    await post('logout', {});
    expect(await status()).toEqual({ setupRequired: false, loggedIn: false });

    const bad = await post('login', { password: 'nope' });
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toMatchObject({ error: { code: 'bad_password' } });
    expect((await status()).loggedIn).toBe(false);

    expect((await post('login', { password: PASSWORD })).statusCode).toBe(200);
    expect((await status()).loggedIn).toBe(true);
  });

  it('locks out after five wrong passwords, even for the right one, then recovers', async () => {
    build();
    await post('setup', { password: PASSWORD });
    await post('logout', {});
    for (let i = 0; i < 5; i++) await post('login', { password: 'wrong' });

    const locked = await post('login', { password: PASSWORD });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({
      error: { code: 'rate_limited', details: { retryAfterSec: 30 } },
    });

    clock += 30_000;
    expect((await post('login', { password: PASSWORD })).statusCode).toBe(200);
  });

  it('keeps routes behind requireLogin closed until login and after logout', async () => {
    build();
    const secret = () => app.inject({ url: '/api/v1/secret', headers: HEADERS });
    await post('setup', { password: PASSWORD });
    await post('logout', {});

    const closed = await secret();
    expect(closed.statusCode).toBe(401);
    expect(closed.json()).toMatchObject({ error: { code: 'login_required' } });

    await post('login', { password: PASSWORD });
    expect((await secret()).statusCode).toBe(200);

    await post('logout', {});
    expect((await secret()).statusCode).toBe(401);
  });

  it('needs the teacher token for the auth routes too', async () => {
    build();
    const res = await app.inject({ url: '/api/v1/auth/status' });
    expect(res.statusCode).toBe(401);
  });
});

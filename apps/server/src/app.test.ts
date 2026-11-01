import { afterEach, describe, expect, it } from 'vitest';
import { withInject, type Injectable } from './testing/inject.js';
import type { TeacherApp } from './app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase } from './db/connectDb.js';
import { buildTeacherApp } from './app.js';

const TOKEN = 't'.repeat(40);
let app: Injectable<TeacherApp>;
let cleanup: (() => void) | undefined;

function build() {
  const dir = mkdtempSync(join(tmpdir(), 'eg-teacher-app-'));
  const db = initDatabase(dir);
  const built = buildTeacherApp({ token: TOKEN, db });
  app = withInject(built);
  cleanup = () => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return built;
}

afterEach(async () => {
  await app.close();
  cleanup?.();
});

describe('teacher app', () => {
  it('answers health with the right token', async () => {
    build();
    const res = await app.inject({
      url: '/api/v1/health',
      headers: { 'x-teacher-token': TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', protocol: { major: 1 } });
  });

  it('rejects a missing token with the protocol error shape', async () => {
    build();
    const res = await app.inject({ url: '/api/v1/health' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('rejects a wrong token, including one of a different length', async () => {
    build();
    for (const bad of ['x'.repeat(40), 'short']) {
      const res = await app.inject({ url: '/api/v1/health', headers: { 'x-teacher-token': bad } });
      expect(res.statusCode).toBe(401);
    }
  });

  it('answers a CORS preflight without a token and tags real answers with CORS headers', async () => {
    build();
    const pre = await app.inject({ method: 'OPTIONS', url: '/api/v1/auth/login' });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-headers']).toContain('x-teacher-token');
    const denied = await app.inject({ url: '/api/v1/health' });
    expect(denied.statusCode).toBe(401);
    expect(denied.headers['access-control-allow-origin']).toBe('*');
  });

  it('also guards unknown routes', async () => {
    build();
    const res = await app.inject({ url: '/api/v1/nope' });
    expect(res.statusCode).toBe(401);
  });

  it('answers an unknown route with the token as a 404 envelope', async () => {
    build();
    const res = await app.inject({ url: '/api/v1/nope', headers: { 'x-teacher-token': TOKEN } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('answers a body that is not JSON with a 400 envelope', async () => {
    build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-teacher-token': TOKEN, 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'invalid_json' } });
  });

  it('refuses a JSON body over 1 MB with a 413 envelope', async () => {
    build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-teacher-token': TOKEN },
      payload: { password: 'x'.repeat(1_100_000) },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: { code: 'payload_too_large' } });
  });
});

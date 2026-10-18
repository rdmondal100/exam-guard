import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTeacherApp } from './teacher-app.js';

const TOKEN = 't'.repeat(40);
let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

describe('teacher app', () => {
  it('answers health with the right token', async () => {
    app = buildTeacherApp({ token: TOKEN });
    const res = await app.inject({
      url: '/api/v1/health',
      headers: { 'x-teacher-token': TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', protocol: { major: 1 } });
  });

  it('rejects a missing token with the protocol error shape', async () => {
    app = buildTeacherApp({ token: TOKEN });
    const res = await app.inject({ url: '/api/v1/health' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('rejects a wrong token, including one of a different length', async () => {
    app = buildTeacherApp({ token: TOKEN });
    for (const bad of ['x'.repeat(40), 'short']) {
      const res = await app.inject({ url: '/api/v1/health', headers: { 'x-teacher-token': bad } });
      expect(res.statusCode).toBe(401);
    }
  });

  it('also guards unknown routes', async () => {
    app = buildTeacherApp({ token: TOKEN });
    const res = await app.inject({ url: '/api/v1/nope' });
    expect(res.statusCode).toBe(401);
  });
});

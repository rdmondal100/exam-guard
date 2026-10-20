import { X509Certificate } from 'node:crypto';
import { createServer, type Server } from 'node:https';
import { generate } from 'selfsigned';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { JoinAttempt } from '@examguard/shared';
import { JoinClient } from './join-client.js';
import { fingerprintOfDer } from './tls-pin.js';

interface Seen {
  method: string;
  url: string;
  authorization?: string | undefined;
  body: unknown;
}

let server: Server;
let port: number;
let fingerprint: string;
let seen: Seen[];
let reply: (seen: Seen) => { status: number; body: unknown };

beforeAll(async () => {
  const pems = await generate([{ name: 'commonName', value: 'ExamGuard' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
  });
  fingerprint = fingerprintOfDer(new X509Certificate(pems.cert).raw);
  server = createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const entry: Seen = {
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers.authorization,
        body: raw ? (JSON.parse(raw) as unknown) : undefined,
      };
      seen.push(entry);
      const { status, body } = reply(entry);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : 0;
});
afterAll(() => {
  server.close();
});

const TOKEN = 'secret-token-value-123456';
const GOOD = {
  token: TOKEN,
  examStudentId: 'es1',
  name: 'Ada',
  examTitle: 'Mid',
  state: 'not_joined',
};
const attempt = (over: Partial<JoinAttempt> = {}): JoinAttempt => ({
  address: '127.0.0.1',
  port,
  fingerprint,
  studentCode: '1',
  pin: '123456',
  ...over,
});

let client: JoinClient;
beforeEach(() => {
  seen = [];
  reply = () => ({ status: 200, body: GOOD });
  client = new JoinClient(async () => 'device-xyz');
});

describe('JoinClient.join', () => {
  it('posts the credentials, device id and protocol, and hides the token', async () => {
    const result = await client.join(attempt());
    expect(result).toEqual({ ok: true, examStudentId: 'es1', name: 'Ada', examTitle: 'Mid' });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(seen[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/join',
      body: {
        studentCode: '1',
        pin: '123456',
        deviceId: 'device-xyz',
        protocol: { major: 1 },
        agent: { ok: true },
      },
    });
  });

  it('refuses a different certificate before sending the PIN', async () => {
    const result = await client.join(attempt({ fingerprint: 'A'.repeat(43) }));
    expect(result).toMatchObject({ ok: false, code: 'fingerprint_mismatch' });
    expect(seen).toHaveLength(0);
  });

  it.each([
    [401, 'bad_pin'],
    [403, 'not_on_list'],
    [409, 'already_active_elsewhere'],
    [426, 'protocol_mismatch'],
  ])('maps a %i %s answer', async (status, code) => {
    reply = () => ({ status, body: { error: { code, message: 'x' } } });
    expect(await client.join(attempt())).toMatchObject({ ok: false, code });
  });

  it('passes on the wait time for rate limiting', async () => {
    reply = () => ({
      status: 429,
      body: { error: { code: 'rate_limited', message: 'x', details: { retryAfterSec: 42 } } },
    });
    expect(await client.join(attempt())).toMatchObject({
      ok: false,
      code: 'rate_limited',
      retryAfterSec: 42,
    });
  });

  it('treats an unknown error code or a malformed success as bad_response', async () => {
    reply = () => ({ status: 500, body: { error: { code: 'boom' } } });
    expect(await client.join(attempt())).toMatchObject({ code: 'bad_response' });
    reply = () => ({ status: 200, body: { hello: 'world' } });
    expect(await client.join(attempt())).toMatchObject({ code: 'bad_response' });
  });

  it('reports an unreachable host', async () => {
    expect(await client.join(attempt({ port: 1 }))).toMatchObject({ code: 'unreachable' });
  });
});

describe('JoinClient.confirm', () => {
  it('needs a successful join first', async () => {
    expect(await client.confirm()).toMatchObject({ ok: false, code: 'no_session' });
  });

  it('sends the bearer token and the accepted notice', async () => {
    await client.join(attempt());
    reply = () => ({ status: 200, body: { ok: true, state: 'lobby' } });
    expect(await client.confirm()).toEqual({ ok: true });
    expect(seen[1]).toMatchObject({
      url: '/api/v1/join/confirm',
      authorization: `Bearer ${TOKEN}`,
      body: { noticeAccepted: true },
    });
  });

  it('drops the session on a 401', async () => {
    await client.join(attempt());
    reply = () => ({ status: 401, body: { error: { code: 'unauthorized', message: 'x' } } });
    expect(await client.confirm()).toMatchObject({ code: 'no_session' });
    expect(await client.confirm()).toMatchObject({ code: 'no_session' });
    expect(seen).toHaveLength(2);
  });
});

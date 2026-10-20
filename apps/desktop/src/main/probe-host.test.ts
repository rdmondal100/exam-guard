import { createServer, type Server } from 'node:https';
import { X509Certificate } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generate } from 'selfsigned';
import { probeHost } from './probe-host.js';
import { fingerprintOfDer, pinnedGet } from './tls-pin.js';

const INFO = {
  examTitle: 'Mid',
  protocol: { major: 1, minor: 0 },
  state: 'hosting',
  fpCode: '7ACN',
};

let server: Server;
let port: number;
let fingerprint: string;
let seenRequests = 0;
let respond: () => { status: number; body: string };

async function makeCert() {
  const pems = await generate([{ name: 'commonName', value: 'ExamGuard' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
  });
  return { key: pems.private, cert: pems.cert };
}

beforeAll(async () => {
  const pems = await makeCert();
  fingerprint = fingerprintOfDer(new X509Certificate(pems.cert).raw);
  server = createServer(pems, (req, res) => {
    seenRequests++;
    const { status, body } = respond();
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : 0;
});

afterAll(() => {
  server.close();
});

const ok = () => ({ status: 200, body: JSON.stringify(INFO) });

describe('pinnedGet', () => {
  it('trusts on first use and reports the fingerprint', async () => {
    respond = ok;
    const res = await pinnedGet({ address: '127.0.0.1', port }, '/api/v1/info');
    expect(res.status).toBe(200);
    expect(res.fingerprint).toBe(fingerprint);
  });

  it('accepts the matching pinned fingerprint', async () => {
    respond = ok;
    const res = await pinnedGet(
      { address: '127.0.0.1', port, expectedFingerprint: fingerprint },
      '/api/v1/info',
    );
    expect(res.status).toBe(200);
  });

  it('refuses a different cert before sending any request', async () => {
    respond = ok;
    const before = seenRequests;
    await expect(
      pinnedGet(
        { address: '127.0.0.1', port, expectedFingerprint: 'A'.repeat(43) },
        '/api/v1/info',
      ),
    ).rejects.toMatchObject({ code: 'fingerprint_mismatch' });
    expect(seenRequests).toBe(before);
  });

  it('reports an unreachable host', async () => {
    await expect(
      pinnedGet({ address: '127.0.0.1', port: 1, timeoutMs: 500 }, '/'),
    ).rejects.toMatchObject({ code: 'unreachable' });
  });
});

describe('probeHost', () => {
  it('returns the info and fingerprint', async () => {
    respond = ok;
    const result = await probeHost({ address: '127.0.0.1', port });
    expect(result).toMatchObject({ ok: true, port, fingerprint, info: INFO });
  });

  it('maps a fingerprint mismatch to a clear message', async () => {
    respond = ok;
    const result = await probeHost({
      address: '127.0.0.1',
      port,
      expectedFingerprint: 'B'.repeat(43),
    });
    expect(result).toMatchObject({ ok: false, code: 'fingerprint_mismatch' });
    expect(result.ok ? '' : result.message).toMatch(/does not match/);
  });

  it('maps 503 to not_hosting', async () => {
    respond = () => ({ status: 503, body: '{}' });
    expect(await probeHost({ address: '127.0.0.1', port })).toMatchObject({
      ok: false,
      code: 'not_hosting',
    });
  });

  it('rejects a reply that is not ExamGuard info', async () => {
    respond = () => ({ status: 200, body: '{"hello":1}' });
    expect(await probeHost({ address: '127.0.0.1', port })).toMatchObject({
      ok: false,
      code: 'bad_response',
    });
    respond = () => ({ status: 200, body: 'not json' });
    expect(await probeHost({ address: '127.0.0.1', port })).toMatchObject({
      ok: false,
      code: 'bad_response',
    });
  });

  it('refuses a different protocol major', async () => {
    respond = () => ({
      status: 200,
      body: JSON.stringify({ ...INFO, protocol: { major: 2, minor: 0 } }),
    });
    expect(await probeHost({ address: '127.0.0.1', port })).toMatchObject({
      ok: false,
      code: 'incompatible_protocol',
    });
  });
});

import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ExamFile } from '@examguard/shared';
import { fingerprintOfDer } from '../tls-pin.js';
import { DownloadError, downloadExamFile } from './pinned-download.js';

const BYTES = Buffer.from('a,b\n1,2\n3,4\n');
const FILE: ExamFile = {
  id: 'file one',
  name: 'data.csv',
  size: BYTES.length,
  sha256: createHash('sha256').update(BYTES).digest('hex'),
};
const TOKEN = 'student-session-token';

interface Seen {
  url: string;
  authorization?: string | undefined;
}

let server: Server;
let port: number;
let fingerprint: string;
let seen: Seen[];
let answer: (res: ServerResponse) => void;
let dir: string;
let dest: string;

beforeAll(async () => {
  const pems = await generate([{ name: 'commonName', value: 'ExamGuard' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
  });
  fingerprint = fingerprintOfDer(new X509Certificate(pems.cert).raw);
  server = createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    seen.push({ url: req.url ?? '', authorization: req.headers.authorization });
    answer(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : 0;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  seen = [];
  answer = (res) => {
    res.writeHead(200, { 'content-length': BYTES.length });
    res.end(BYTES);
  };
  dir = mkdtempSync(join(tmpdir(), 'eg-dl-'));
  dest = join(dir, 'stage', 'file-one');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const download = (over: Partial<Parameters<typeof downloadExamFile>[0]> = {}) =>
  downloadExamFile({
    target: { address: '127.0.0.1', port, expectedFingerprint: fingerprint },
    token: TOKEN,
    file: FILE,
    destPath: dest,
    ...over,
  });
const leftovers = () => (existsSync(join(dir, 'stage')) ? readdirSync(join(dir, 'stage')) : []);

describe('downloadExamFile', () => {
  it('saves the verified file, asking with the session token', async () => {
    await download();
    expect(readFileSync(dest)).toEqual(BYTES);
    expect(leftovers()).toEqual(['file-one']);
    expect(seen).toEqual([
      { url: '/api/v1/exam-files/file%20one', authorization: `Bearer ${TOKEN}` },
    ]);
  });

  it('replaces a file that is already there', async () => {
    await download();
    writeFileSync(dest, 'stale');
    await download();
    expect(readFileSync(dest)).toEqual(BYTES);
  });

  it('keeps nothing when the checksum is wrong', async () => {
    const wrong = Buffer.from('x,y\n9,9\n9,9\n');
    expect(wrong.length).toBe(BYTES.length);
    answer = (res) => {
      res.writeHead(200, { 'content-length': wrong.length });
      res.end(wrong);
    };
    const error = await download().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect(error).toMatchObject({ code: 'bad_hash' });
    expect(leftovers()).toEqual([]);
  });

  it('refuses a file whose size is not what the manifest said', async () => {
    answer = (res) => {
      res.writeHead(200, { 'content-length': BYTES.length + 5 });
      res.end(Buffer.concat([BYTES, Buffer.from('extra')]));
    };
    await expect(download()).rejects.toMatchObject({ code: 'bad_size' });
    expect(leftovers()).toEqual([]);
  });

  it('keeps nothing when the connection drops half way', async () => {
    answer = (res) => {
      res.writeHead(200, { 'content-length': BYTES.length });
      res.write(BYTES.subarray(0, 4));
      setTimeout(() => res.destroy(), 20);
    };
    await expect(download()).rejects.toBeInstanceOf(DownloadError);
    expect(leftovers()).toEqual([]);
  });

  it.each([
    [401, false],
    [403, false],
    [404, false],
    [409, false],
    [503, true],
  ])('a %i answer is refused (retryable: %s)', async (status, retryable) => {
    answer = (res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end('{"error":{"code":"x","message":"no"}}');
    };
    const error = await download().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'refused', retryable });
    expect(leftovers()).toEqual([]);
  });

  it('does not send the token to a host with another certificate', async () => {
    const error = await download({
      target: { address: '127.0.0.1', port, expectedFingerprint: 'not-the-pinned-one' },
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'fingerprint_mismatch' });
    expect(seen).toEqual([]);
  });

  it('gives up on a server that never answers', async () => {
    answer = () => {};
    await expect(download({ timeoutMs: 300 })).rejects.toBeInstanceOf(DownloadError);
    expect(leftovers()).toEqual([]);
  });

  it('reports an unreachable server', async () => {
    const error = await download({
      target: { address: '127.0.0.1', port: 1, expectedFingerprint: fingerprint },
      timeoutMs: 500,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'unreachable' });
  });
});

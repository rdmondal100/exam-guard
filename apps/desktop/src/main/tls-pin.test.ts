import { createServer, type Server } from 'node:https';
import { X509Certificate } from 'node:crypto';
import type { Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generate } from 'selfsigned';
import { fingerprintOfDer, pinnedGet } from './tls-pin.js';

let server: Server;
let port: number;
const open = new Set<Socket>();

beforeAll(async () => {
  const pems = await generate([{ name: 'commonName', value: 'ExamGuard' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
  });
  const material = { key: pems.private, cert: pems.cert };
  expect(fingerprintOfDer(new X509Certificate(material.cert).raw)).toBeTruthy();
  server = createServer(material, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  server.on('secureConnection', (socket) => {
    open.add(socket);
    socket.on('close', () => open.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : 0;
});

afterAll(() => {
  server.close();
});

async function untilClosed(): Promise<void> {
  const end = Date.now() + 1000;
  while (open.size > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
}

describe('pinnedRequest', () => {
  it('closes its TLS socket once the response has arrived', async () => {
    const res = await pinnedGet({ address: '127.0.0.1', port }, '/');
    expect(res.body).toBe('ok');
    await untilClosed();
    // The server's keep-alive timeout is 5 s, so a socket left open here would still be counted.
    expect(open.size).toBe(0);
  });
});

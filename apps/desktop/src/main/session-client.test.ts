import { X509Certificate } from 'node:crypto';
import { createServer, type Server } from 'node:https';
import { generate } from 'selfsigned';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionStatus } from '@examguard/shared';
import { SessionClient, reconnectDelay } from './session-client.js';
import { fingerprintOfDer } from './tls-pin.js';

let https: Server;
let wss: WebSocketServer;
let port: number;
let fingerprint: string;
let clients: ServerSocket[];
let frames: unknown[];
let skew: number;
let welcomeWith: 'welcome' | { closeCode: number };

beforeAll(async () => {
  const pems = await generate([{ name: 'commonName', value: 'ExamGuard' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
  });
  fingerprint = fingerprintOfDer(new X509Certificate(pems.cert).raw);
  https = createServer({ key: pems.private, cert: pems.cert });
  wss = new WebSocketServer({ server: https, path: '/ws' });
  wss.on('connection', (socket) => {
    clients.push(socket);
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as { t: string; clientSent?: number };
      frames.push(message);
      if (message.t === 'hello') {
        if (welcomeWith !== 'welcome') return socket.close(welcomeWith.closeCode, 'no');
        socket.send(JSON.stringify({ t: 'welcome', serverTime: Date.now() + skew, state: STATE }));
      } else if (message.t === 'ping') {
        socket.send(
          JSON.stringify({
            t: 'pong',
            clientSent: message.clientSent,
            serverTime: Date.now() + skew,
          }),
        );
      }
    });
  });
  await new Promise<void>((resolve) => https.listen(0, '127.0.0.1', resolve));
  const address = https.address();
  port = typeof address === 'object' && address ? address.port : 0;
});
afterAll(() => {
  wss.close();
  https.close();
});

const STATE = {
  examState: 'hosting',
  studentState: 'lobby',
  deadline: null,
  saved: [],
  locked: false,
  monitoring: false,
};

let statuses: SessionStatus[];
let client: SessionClient;

beforeEach(() => {
  clients = [];
  frames = [];
  skew = 0;
  welcomeWith = 'welcome';
  statuses = [];
  client = new SessionClient({
    onStatus: (s) => statuses.push(s),
    pingMs: 50,
    random: () => 0,
  });
});
afterEach(() => client.stop());

const TOKEN = 'secret-token-value-123456';
const target = () => ({ address: '127.0.0.1', port, expectedFingerprint: fingerprint });

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
const links = () => statuses.map((s) => s.link);

describe('SessionClient', () => {
  it('says hello with the token and reaches connected', async () => {
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    expect(links()[0]).toBe('connecting');
    expect(frames[0]).toMatchObject({
      t: 'hello',
      token: TOKEN,
      protocol: { major: 1 },
      resume: { lastServerSeq: 0 },
    });
  });

  it('keeps pinging and estimates the server clock offset', async () => {
    skew = 5000;
    client.start(target(), TOKEN);
    await until(() => frames.filter((f) => (f as { t: string }).t === 'ping').length >= 2);
    await until(() => client.clockOffsetMs !== null);
    expect(Math.abs((client.clockOffsetMs ?? 0) - 5000)).toBeLessThan(200);
    expect(statuses.at(-1)?.offsetMs).not.toBeNull();
  });

  it('refuses a wrong fingerprint before sending hello', async () => {
    client.start({ ...target(), expectedFingerprint: 'A'.repeat(43) }, TOKEN);
    await until(() => links().includes('failed'));
    expect(statuses.at(-1)?.reason).toBe('fingerprint_mismatch');
    expect(frames).toHaveLength(0);
  });

  it('reconnects after the server drops the socket', async () => {
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    for (const c of clients) c.terminate();
    await until(() => links().includes('reconnecting'));
    await until(
      () =>
        clients.length >= 2 && links().lastIndexOf('connected') > links().indexOf('reconnecting'),
    );
    expect(frames.filter((f) => (f as { t: string }).t === 'hello')).toHaveLength(2);
  });

  it('gives up when the server says the sign-in is no longer valid', async () => {
    welcomeWith = { closeCode: 4401 };
    client.start(target(), TOKEN);
    await until(() => links().includes('failed'));
    expect(statuses.at(-1)?.reason).toBe('unauthorized');
    await new Promise((r) => setTimeout(r, 150));
    expect(frames).toHaveLength(1);
  });

  it('does not retry after being replaced by another window', async () => {
    welcomeWith = { closeCode: 4409 };
    client.start(target(), TOKEN);
    await until(() => links().includes('failed'));
    expect(statuses.at(-1)?.reason).toBe('replaced');
  });

  it('stop() ends the session without further status', async () => {
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    client.stop();
    const count = statuses.length;
    await new Promise((r) => setTimeout(r, 150));
    expect(statuses).toHaveLength(count);
  });
});

describe('reconnectDelay', () => {
  it('doubles from 0.5 s up to 5 s', () => {
    const full = () => 1;
    expect([0, 1, 2, 3, 4, 8].map((n) => reconnectDelay(n, full))).toEqual([
      500, 1000, 2000, 4000, 5000, 5000,
    ]);
  });

  it('jitters between half and full', () => {
    expect(reconnectDelay(2, () => 0)).toBe(1000);
    expect(reconnectDelay(2, () => 0.5)).toBe(1500);
  });
});

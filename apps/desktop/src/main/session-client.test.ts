import { X509Certificate } from 'node:crypto';
import { createServer, type Server } from 'node:https';
import { generate } from 'selfsigned';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionStatus } from '@examguard/shared';
import { OfflineQueue } from './resume/offline-queue.js';
import type { SecretBox } from './resume/secret-box.js';
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
let ackEvents: boolean;
let welcomeSaved: unknown[];
let mute: boolean;

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
      const message = JSON.parse(data.toString()) as {
        t: string;
        clientSent?: number;
        id?: string;
        key?: string;
        clientSeq?: number;
      };
      frames.push(message);
      if (mute && message.t !== 'hello') return;
      if (message.t === 'hello') {
        if (welcomeWith !== 'welcome') return socket.close(welcomeWith.closeCode, 'no');
        socket.send(
          JSON.stringify({
            t: 'welcome',
            serverTime: Date.now() + skew,
            state: { ...STATE, saved: welcomeSaved },
          }),
        );
      } else if (message.t === 'event' && ackEvents) {
        socket.send(JSON.stringify({ t: 'event.ack', id: message.id }));
      } else if (message.t === 'answer.save' && ackEvents) {
        socket.send(
          JSON.stringify({ t: 'answer.ack', id: message.id, clientSeq: message.clientSeq }),
        );
      } else if (message.t === 'transcript' && ackEvents) {
        socket.send(JSON.stringify({ t: 'transcript.ack', key: message.key }));
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
  terminal: { enabled: false, until: null },
  filesEnabled: true,
  examFiles: [],
};

let statuses: SessionStatus[];
let client: SessionClient;

beforeEach(() => {
  clients = [];
  frames = [];
  skew = 0;
  welcomeWith = 'welcome';
  ackEvents = true;
  welcomeSaved = [];
  mute = false;
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

describe('SessionClient exam state', () => {
  it('reports the welcome state and merges later state pushes', async () => {
    const seen: { examState: string; deadline: number | null; studentState: string }[] = [];
    client = new SessionClient({
      onStatus: (s) => statuses.push(s),
      onExam: (state) => seen.push(state),
      pingMs: 50,
      random: () => 0,
    });
    client.start(target(), TOKEN);
    await until(() => seen.length >= 1);
    expect(seen[0]).toMatchObject({ examState: 'hosting', deadline: null });

    clients[0]?.send(
      JSON.stringify({
        t: 'state',
        state: { examState: 'running', studentState: 'active', deadline: 123_456 },
      }),
    );
    await until(() => seen.length >= 2);
    expect(seen[1]).toMatchObject({
      examState: 'running',
      studentState: 'active',
      deadline: 123_456,
      locked: false,
    });
  });
});

describe('SessionClient events', () => {
  interface Sent {
    t: string;
    id: string;
    dedupeKey: string;
    type: string;
    details: object;
  }
  const events = () => (frames as Sent[]).filter((f) => f.t === 'event');

  it('holds an event until welcome, then sends it', async () => {
    client.sendEvent('run_executed', { status: 'ok' });
    client.start(target(), TOKEN);
    await until(() => events().length === 1);
    expect(events()[0]).toMatchObject({ type: 'run_executed', details: { status: 'ok' } });
    expect(events()[0]?.dedupeKey).toBe(events()[0]?.id);
  });

  it('re-sends an unacked event after a reconnect, and not an acked one', async () => {
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    client.sendEvent('run_executed', { n: 1 });
    await until(() => events().length === 1);
    ackEvents = false;
    client.sendEvent('run_executed', { n: 2 });
    await until(() => events().length === 2);
    for (const c of clients) c.terminate();
    await until(() => events().length === 3);
    expect(events()[2]?.details).toEqual({ n: 2 });
    expect(events()[2]?.id).toBe(events()[1]?.id);
  });
});

describe('SessionClient transcript', () => {
  const chunks = () =>
    (frames as { t: string; key: string; text: string }[]).filter((f) => f.t === 'transcript');

  it('re-sends an unacked chunk after a reconnect, and not an acked one', async () => {
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    client.sendTranscript('s:1', 'PS> dir');
    await until(() => chunks().length === 1);
    ackEvents = false;
    client.sendTranscript('s:2', 'file.txt');
    await until(() => chunks().length === 2);
    for (const c of clients) c.terminate();
    await until(() => chunks().length === 3);
    expect(chunks()[2]).toMatchObject({ key: 's:2', text: 'file.txt' });
  });
});

describe('SessionClient answers', () => {
  interface Saved {
    t: string;
    id: string;
    clientSeq: number;
    clientTs: number;
    questionId: string;
    language: string;
    content: string;
  }
  const saves = () => (frames as Saved[]).filter((f) => f.t === 'answer.save');
  const request = (content: string) => ({
    questionId: 'q1',
    language: 'c',
    content,
    selected: true,
    reason: 'interval' as const,
  });

  it('numbers saves from 1, stamps them in server time and reports the pending count', async () => {
    const pending: number[] = [];
    client = new SessionClient({
      onStatus: (s) => statuses.push(s),
      onAnswers: (s) => pending.push(s.pending),
      pingMs: 50,
      random: () => 0,
    });
    skew = 5_000;
    client.start(target(), TOKEN);
    await until(() => client.clockOffsetMs !== null);
    client.sendAnswer(request('a'));
    client.sendAnswer(request('ab'));
    await until(() => saves().length === 2);
    expect(saves().map((s) => s.clientSeq)).toEqual([1, 2]);
    const stamp = saves()[0]?.clientTs ?? 0;
    expect(Math.abs(stamp - (Date.now() + 5_000))).toBeLessThan(1_000);
    await until(() => pending.at(-1) === 0);
    expect(pending[0]).toBe(1);
    expect(client.answerStatus.lastAckAt).not.toBeNull();
  });

  it('holds a save until welcome, then sends it', async () => {
    client.sendAnswer(request('early'));
    expect(saves()).toHaveLength(0);
    client.start(target(), TOKEN);
    await until(() => saves().length === 1);
    expect(saves()[0]).toMatchObject({ clientSeq: 1, content: 'early' });
  });

  it('re-sends an unacked save with the same number after a reconnect, and not an acked one', async () => {
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    client.sendAnswer(request('one'));
    await until(() => saves().length === 1);
    await until(() => client.answerStatus.pending === 0);
    ackEvents = false;
    client.sendAnswer(request('two'));
    await until(() => saves().length === 2);
    for (const c of clients) c.terminate();
    await until(() => saves().length === 3);
    expect(saves()[2]).toMatchObject({ clientSeq: 2, content: 'two' });
    expect(saves()[2]?.id).toBe(saves()[1]?.id);
  });

  it('continues after the newest number the server already holds', async () => {
    welcomeSaved = [
      { questionId: 'q1', language: 'c', clientSeq: 7, selected: true },
      { questionId: 'q2', language: 'text', clientSeq: 4, selected: true },
    ];
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    client.sendAnswer(request('after restart'));
    await until(() => saves().length === 1);
    expect(saves()[0]?.clientSeq).toBe(8);
  });
});

describe('SessionClient watchdog', () => {
  it('drops a socket that goes silent (a pulled cable) and connects again', async () => {
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    mute = true;
    await until(() => links().includes('reconnecting'));
    await until(() => frames.filter((f) => (f as { t: string }).t === 'hello').length === 2);
    await until(() => links().lastIndexOf('connected') > links().indexOf('reconnecting'));
  });
});

describe('SessionClient offline queue', () => {
  const box: SecretBox = {
    encrypt: (text) => Buffer.from(text).toString('base64'),
    decrypt: (text) => Buffer.from(text, 'base64').toString('utf8'),
  };
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eg-sq-'));
    file = join(dir, 'q.jsonl');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const queue = () => new OfflineQueue(file, box, () => {});
  const request = (content: string) => ({
    questionId: 'q1',
    language: 'c',
    content,
    selected: true,
    reason: 'interval' as const,
  });
  const saves = () =>
    (frames as { t: string; clientSeq: number; content: string }[]).filter(
      (f) => f.t === 'answer.save',
    );

  it('keeps a save on disk until the server acks it', async () => {
    ackEvents = false;
    client.start(target(), TOKEN, queue());
    await until(() => links().includes('connected'));
    client.sendAnswer(request('typed offline'));
    expect(
      queue()
        .load()
        .map((i) => (i.t === 'answer.save' ? i.content : i.t)),
    ).toEqual(['typed offline']);
    ackEvents = true;
    for (const c of clients) c.terminate(); // the reconnect re-sends it, and this time it is acked
    await until(() => client.answerStatus.pending === 0);
    expect(queue().load()).toEqual([]);
  });

  it('sends what an earlier run left, once connected, and numbers the next save after it', async () => {
    const earlier = queue();
    earlier.add({
      t: 'answer.save',
      id: 'old',
      clientSeq: 7,
      clientTs: 1,
      ...request('from before the restart'),
    });
    earlier.add({
      t: 'event',
      id: 'ev-old',
      dedupeKey: 'ev-old',
      clientTs: 2,
      type: 'run_executed',
      details: {},
    });
    earlier.add({ t: 'transcript', key: 's:old', clientTs: 3, text: 'dir' });

    client.start(target(), TOKEN, queue());
    await until(() => saves().length === 1);
    expect(saves()[0]).toMatchObject({ clientSeq: 7, content: 'from before the restart' });
    await until(() => frames.some((f) => (f as { t: string }).t === 'event'));
    await until(() => frames.some((f) => (f as { t: string }).t === 'transcript'));
    await until(() => queue().load().length === 0);

    client.sendAnswer(request('after'));
    await until(() => saves().length === 2);
    expect(saves()[1]?.clientSeq).toBe(8);
  });

  it('survives the client being replaced while the server was not acking', async () => {
    ackEvents = false;
    client.start(target(), TOKEN, queue());
    await until(() => links().includes('connected'));
    client.sendAnswer(request('unacked'));
    client.sendEvent('run_executed', { n: 1 });
    client.stop();

    ackEvents = true;
    const next = new SessionClient({ onStatus: () => {}, pingMs: 50, random: () => 0 });
    next.start(target(), TOKEN, queue());
    await until(() => saves().filter((s) => s.content === 'unacked').length === 2);
    await until(() => next.answerStatus.pending === 0);
    next.stop();
    expect(
      queue()
        .load()
        .filter((i) => i.t === 'answer.save'),
    ).toEqual([]);
  });

  it('forgets a save the cap pushes out', async () => {
    ackEvents = false;
    const q = queue();
    client.start(target(), TOKEN, q);
    await until(() => links().includes('connected'));
    for (let i = 0; i < 502; i++) client.sendAnswer(request(`v${i}`));
    const kept = queue().load();
    expect(kept).toHaveLength(500);
    expect(kept[0]).toMatchObject({ clientSeq: 3 });
  });
});

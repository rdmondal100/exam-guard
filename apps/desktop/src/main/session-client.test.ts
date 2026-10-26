import { X509Certificate } from 'node:crypto';
import { createServer, type Server } from 'node:https';
import { generate } from 'selfsigned';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SCREENSHOT_CHUNK_BYTES,
  decodeScreenshotFrame,
  type SessionStatus,
} from '@examguard/shared';
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
let submitReply: 'result' | 'refused' | 'none';

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
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        const bytes = new Uint8Array(data as Buffer);
        const chunk = decodeScreenshotFrame(bytes);
        frames.push({ t: 'binary', header: chunk?.header, size: chunk?.payload.length });
        return;
      }
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
      } else if (message.t === 'submit' && submitReply !== 'none') {
        socket.send(
          JSON.stringify(
            submitReply === 'result'
              ? { t: 'submit.result', id: message.id, receipt: RECEIPT }
              : { t: 'submit.refused', id: message.id, reason: 'not_working' },
          ),
        );
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

const RECEIPT = { hash: 'a'.repeat(64), submittedAt: 99, answers: [] };
const STATE = {
  examState: 'hosting',
  studentState: 'lobby',
  deadline: null,
  saved: [],
  locked: false,
  monitoring: false,
  terminal: { enabled: false, until: null },
  internet: 'allowed',
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
  submitReply = 'result';
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

describe('SessionClient evidence', () => {
  interface Sent {
    t: string;
    id: string;
    dedupeKey: string;
    type: string;
    screenshotRef?: string;
    details: object;
  }
  const events = () => (frames as Sent[]).filter((f) => f.t === 'event');
  const binary = () =>
    (
      frames as {
        t: string;
        header?: { ref: string; index: number; total: number };
        size: number;
      }[]
    ).filter((f) => f.t === 'binary');
  const evidence = (key: string, jpeg?: Uint8Array) => ({
    key,
    type: 'focus_lost' as const,
    clientTs: 5,
    details: { exe: 'chrome.exe' },
    ...(jpeg ? { jpeg } : {}),
  });

  it('sends the screenshot as binary chunks before the event that names it', async () => {
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    const jpeg = new Uint8Array(SCREENSHOT_CHUNK_BYTES + 100).fill(7);
    client.sendEvidence(evidence('s1:5', jpeg), () => undefined);
    await until(() => events().length === 1);
    expect(events()[0]).toMatchObject({
      id: 's1:5',
      dedupeKey: 's1:5',
      type: 'focus_lost',
      screenshotRef: 's1:5',
    });
    expect(binary().map((b) => b.header)).toEqual([
      { ref: 's1:5', index: 0, total: 2 },
      { ref: 's1:5', index: 1, total: 2 },
    ]);
    expect(binary().map((b) => b.size)).toEqual([SCREENSHOT_CHUNK_BYTES, 100]);
    // The chunks arrived first on the ordered socket.
    const order = frames
      .map((f) => (f as { t: string }).t)
      .filter((t) => t === 'binary' || t === 'event');
    expect(order).toEqual(['binary', 'binary', 'event']);
  });

  it('calls back when the server acks, and an event without a picture has no reference', async () => {
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    let acked = 0;
    client.sendEvidence(evidence('s1:6'), () => (acked += 1));
    await until(() => acked === 1);
    expect(events()[0]?.screenshotRef).toBeUndefined();
    expect(binary()).toHaveLength(0);
  });

  it('sends the same key only once while it is in flight', async () => {
    ackEvents = false;
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    client.sendEvidence(evidence('s1:7'), () => undefined);
    client.sendEvidence(evidence('s1:7'), () => undefined);
    await until(() => events().length === 1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(events()).toHaveLength(1);
  });

  it('sends picture and event again after a reconnect until acked', async () => {
    ackEvents = false;
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    client.sendEvidence(evidence('s1:8', new Uint8Array(500).fill(1)), () => undefined);
    await until(() => events().length === 1);
    for (const c of clients) c.terminate();
    await until(() => events().length === 2);
    expect(binary()).toHaveLength(2);
    expect(events()[1]?.id).toBe('s1:8');
  });

  it('forgets evidence when the session is stopped, and keeps it off the disk queue', async () => {
    ackEvents = false;
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    client.sendEvidence(evidence('s1:9'), () => undefined);
    await until(() => events().length === 1);
    client.stop();
    client.start(target(), TOKEN);
    await until(() => links().filter((l) => l === 'connected').length === 2);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(events()).toHaveLength(1);
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

describe('SessionClient submit', () => {
  const submits = () => frames.filter((f) => (f as { t: string }).t === 'submit');
  const watching = () => {
    const seen: { studentState: string; receipt?: unknown }[] = [];
    client = new SessionClient({
      onStatus: (s) => statuses.push(s),
      onExam: (state) => seen.push(state),
      pingMs: 50,
      random: () => 0,
    });
    return seen;
  };

  it('sends the submit after the unacked saves and settles with the receipt in the exam state', async () => {
    const seen = watching();
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    client.sendAnswer({
      questionId: 'q1',
      language: 'text',
      content: 'essay',
      selected: true,
      reason: 'submit',
    });
    const outcome = await client.submit();
    expect(outcome).toEqual({ ok: true });
    const order = frames.map((f) => (f as { t: string }).t);
    expect(order.indexOf('answer.save')).toBeLessThan(order.indexOf('submit'));
    expect(seen.at(-1)).toMatchObject({ studentState: 'submitted', receipt: RECEIPT });
    expect(client.examState?.receipt).toEqual(RECEIPT);
  });

  it('keeps asking after a reconnect until the server answers, and then stops', async () => {
    submitReply = 'none';
    watching();
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    const outcome = client.submit();
    await until(() => submits().length === 1);
    submitReply = 'result';
    for (const c of clients) c.terminate();
    await expect(outcome).resolves.toEqual({ ok: true });
    expect(submits()).toHaveLength(2);
    expect((submits()[0] as { id: string }).id).toBe((submits()[1] as { id: string }).id);
    await new Promise((r) => setTimeout(r, 200));
    expect(submits()).toHaveLength(2);
  });

  it('waits while the link is down and sends on the next welcome', async () => {
    const seen = watching();
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    for (const c of clients) c.terminate();
    await until(() => links().includes('reconnecting'));
    const outcome = client.submit();
    await expect(outcome).resolves.toEqual({ ok: true });
    expect(seen.at(-1)?.studentState).toBe('submitted');
  });

  it('settles with the reason when the server refuses', async () => {
    submitReply = 'refused';
    watching();
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    await expect(client.submit()).resolves.toEqual({ ok: false, reason: 'not_working' });
    // A new try is possible after a refusal.
    submitReply = 'result';
    await expect(client.submit()).resolves.toEqual({ ok: true });
  });

  it('shares one request between two calls', async () => {
    submitReply = 'none';
    watching();
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    const a = client.submit();
    const b = client.submit();
    await until(() => submits().length === 1);
    expect(a).toBe(b);
    client.stop();
    await expect(a).resolves.toEqual({ ok: false, reason: 'stopped' });
  });

  it('is already settled when a pushed state carries the receipt (auto-submit)', async () => {
    submitReply = 'none';
    const seen = watching();
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    const outcome = client.submit();
    clients[0]?.send(
      JSON.stringify({
        t: 'state',
        state: { studentState: 'submitted', receipt: RECEIPT },
      }),
    );
    await expect(outcome).resolves.toEqual({ ok: true });
    expect(seen.at(-1)?.receipt).toEqual(RECEIPT);
    await expect(client.submit()).resolves.toEqual({ ok: true });
  });
});

describe('SessionClient agent status', () => {
  const GOOD = { ok: true, helper: true, captureOk: true, monitors: 2 };
  const agentFrames = () =>
    (frames as { t: string }[]).filter((f) => f.t === 'agent.status') as unknown[];

  it('sends the agent status after the welcome, and again when it changes', async () => {
    client.setAgentStatus(GOOD);
    client.start(target(), TOKEN);
    await until(() => agentFrames().length === 1);
    expect(agentFrames()[0]).toEqual({ t: 'agent.status', ...GOOD });
    client.setAgentStatus({ ...GOOD, ok: false, helper: false });
    await until(() => agentFrames().length === 2);
    expect(agentFrames()[1]).toMatchObject({ ok: false, helper: false });
  });

  it('sends nothing before welcome, and the latest status after a reconnect', async () => {
    client.start(target(), TOKEN);
    await until(() => links().includes('connected'));
    client.setAgentStatus({ ...GOOD, captureOk: false });
    await until(() => agentFrames().length === 1);
    for (const c of clients) c.terminate();
    await until(() => agentFrames().length === 2);
    expect(agentFrames()[1]).toMatchObject({ captureOk: false });
  });
});

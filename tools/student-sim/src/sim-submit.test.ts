import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:https';
import { generate } from 'selfsigned';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildReceiptAnswers, type Receipt } from '@examguard/shared';
import { numberedCodes } from './csv.js';
import { receiptProblem } from './sim-receipt.js';
import { runSim } from './run-sim.js';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const QUESTIONS = [
  { id: 'q1', type: 'code', allowedLanguages: ['c', 'cpp'] },
  { id: 'q2', type: 'written', allowedLanguages: [] },
];

describe('receiptProblem', () => {
  const answers = [
    { questionId: 'q1', language: 'c', content: 'int main(){}' },
    { questionId: 'q2', language: 'text', content: '' },
  ];
  const { hash, answers: listed } = buildReceiptAnswers(answers, sha);
  const receipt: Receipt = { hash, submittedAt: 1, answers: listed };

  it('accepts a consistent receipt, with and without an expectation', () => {
    expect(receiptProblem(receipt, null)).toBeNull();
    expect(receiptProblem(receipt, answers)).toBeNull();
  });

  it('flags a hash that does not follow from the answers', () => {
    expect(receiptProblem({ ...receipt, hash: sha('other') }, null)).toContain('hash');
  });

  it('flags a receipt that differs from what the student wrote', () => {
    const wrote = answers.map((a) =>
      a.questionId === 'q1' ? { ...a, content: 'int main(){return 1;}' } : a,
    );
    expect(receiptProblem(receipt, wrote)).toContain('differs');
  });
});

describe('runSim submit and disconnects against a fake teacher', () => {
  let https: Server;
  let wss: WebSocketServer;
  let port: number;
  let hellos = 0;
  let mode: 'honest' | 'bad-hash';
  const sockets = new Set<ServerSocket>();
  const saved = new Map<string, Map<string, { language: string; content: string }>>();
  const finals = new Map<string, Receipt>();

  const receiptOf = (token: string): Receipt => {
    const mine = saved.get(token) ?? new Map();
    const inputs = QUESTIONS.map((q) => ({
      questionId: q.id,
      language: mine.get(q.id)?.language ?? (q.type === 'code' ? 'c' : 'text'),
      content: mine.get(q.id)?.content ?? '',
    }));
    const built = buildReceiptAnswers(inputs, sha);
    return {
      hash: mode === 'bad-hash' ? sha('tampered') : built.hash,
      submittedAt: Date.now(),
      answers: built.answers,
    };
  };

  beforeAll(async () => {
    const pems = await generate([{ name: 'commonName', value: 'ExamGuard' }], {
      keyType: 'ec',
      curve: 'P-256',
      algorithm: 'sha256',
    });
    https = createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/v1/join') {
          const body = JSON.parse(raw) as { studentCode: string };
          return res.end(JSON.stringify({ token: `token-${body.studentCode}-`.padEnd(24, 'x') }));
        }
        res.end(JSON.stringify({ ok: true, state: 'lobby' }));
      });
    });
    wss = new WebSocketServer({ server: https, path: '/ws' });
    wss.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      let token = '';
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString()) as {
          t: string;
          id?: string;
          token?: string;
          clientSeq?: number;
          questionId?: string;
          language?: string;
          content?: string;
        };
        if (message.t === 'hello') {
          hellos += 1;
          token = message.token ?? '';
          const receipt = finals.get(token);
          socket.send(
            JSON.stringify({
              t: 'welcome',
              serverTime: Date.now(),
              state: { questions: QUESTIONS, saved: [], ...(receipt ? { receipt } : {}) },
            }),
          );
        } else if (message.t === 'answer.save' && message.questionId) {
          const mine = saved.get(token) ?? new Map();
          mine.set(message.questionId, {
            language: message.language ?? 'text',
            content: message.content ?? '',
          });
          saved.set(token, mine);
          socket.send(
            JSON.stringify({ t: 'answer.ack', id: message.id, clientSeq: message.clientSeq }),
          );
        } else if (message.t === 'submit') {
          const receipt = finals.get(token) ?? receiptOf(token);
          finals.set(token, receipt);
          socket.send(JSON.stringify({ t: 'submit.result', id: message.id, receipt }));
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

  afterEach(() => {
    saved.clear();
    finals.clear();
    hellos = 0;
  });

  const until = async (check: () => boolean, ms = 6000) => {
    const end = Date.now() + ms;
    while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  };
  const base = () => ({ host: '127.0.0.1', port, pin: '123456', rampMs: 0 });

  it('submits by itself through random disconnects and every receipt checks out', async () => {
    mode = 'honest';
    const run = runSim(
      { ...base(), autosaveMs: 40, submitAfterMs: 600, disconnectEveryMs: 120 },
      numberedCodes(6),
      100,
    );
    await run.settled();
    await until(() => run.submits().receipts === 6);
    const totals = run.submits();
    expect(totals.receipts).toBe(6);
    expect(totals.selfSubmitted).toBe(6);
    expect(totals.problems).toEqual([]);
    expect(totals.disconnects).toBeGreaterThan(0);
    // Reconnects happened, so there were more hellos than students.
    expect(hellos).toBeGreaterThan(6);
    run.stop();
  });

  it('reports a receipt whose hash does not hold up', async () => {
    mode = 'bad-hash';
    const run = runSim({ ...base(), autosaveMs: 40, submitAfterMs: 300 }, numberedCodes(3), 100);
    await run.settled();
    await until(() => run.submits().receipts === 3);
    const totals = run.submits();
    expect(totals.problems).toHaveLength(3);
    expect(totals.problems[0]?.problem).toContain('hash');
    run.stop();
  });

  it('takes a receipt pushed at time-up, stops saving and does not reconnect', async () => {
    mode = 'honest';
    const run = runSim({ ...base(), autosaveMs: 40 }, numberedCodes(3), 100);
    await run.settled();
    await until(() => run.saves().acked >= 6);
    const receipt = receiptOf('x');
    for (const socket of sockets) {
      socket.send(JSON.stringify({ t: 'state', state: { studentState: 'submitted', receipt } }));
    }
    await until(() => run.submits().receipts === 3);
    expect(run.submits()).toMatchObject({ receipts: 3, selfSubmitted: 0 });
    const hellosBefore = hellos;
    const sentBefore = run.saves().sent;
    for (const socket of [...sockets]) socket.close(4503, 'not_hosting');
    await new Promise((r) => setTimeout(r, 1200));
    expect(hellos).toBe(hellosBefore);
    expect(run.saves().sent).toBe(sentBefore);
    run.stop();
  });
});

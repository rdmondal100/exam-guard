import { createServer, type Server } from 'node:https';
import { generate } from 'selfsigned';
import { WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';
import { numberedCodes, parseStudentCodes } from './csv.js';
import { runSim } from './run-sim.js';

describe('parseArgs', () => {
  const base = ['--host', '10.0.0.5', '--pin', '123456'];

  it('applies defaults', () => {
    expect(parseArgs(base)).toEqual({
      host: '10.0.0.5',
      port: 47820,
      pin: '123456',
      students: 10,
      csv: undefined,
      rampMs: 20,
      autosaveMs: 0,
      submitAfterMs: 0,
      disconnectEveryMs: 0,
    });
  });

  it('reads port, count, csv and ramp, and ignores a bare --', () => {
    const options = parseArgs([
      '--',
      '--host',
      '127.0.0.1:5000',
      '--pin',
      '000001',
      '--students',
      '200',
      '--csv',
      'a.csv',
      '--ramp-ms',
      '0',
      '--autosave-ms',
      '10000',
      '--submit-after-ms',
      '60000',
      '--disconnect-every-ms',
      '20000',
    ]);
    expect(options).toMatchObject({
      port: 5000,
      students: 200,
      csv: 'a.csv',
      rampMs: 0,
      autosaveMs: 10_000,
      submitAfterMs: 60_000,
      disconnectEveryMs: 20_000,
    });
  });

  it.each([
    [[], '--host is required'],
    [['--host', 'x'], '--pin must be 6 digits'],
    [['--host', 'x', '--pin', '12'], '--pin must be 6 digits'],
    [[...base, '--students', '0'], '--students'],
    [[...base, '--students', '5000'], '--students'],
    [[...base, '--students'], 'needs a value'],
    [[...base, '--autosave-ms', '5'], '--autosave-ms'],
    [[...base, '--autosave-ms', 'x'], '--autosave-ms'],
    [[...base, '--submit-after-ms', '50'], '--submit-after-ms'],
    [[...base, '--disconnect-every-ms', '500'], '--disconnect-every-ms'],
    [[...base, '--nope', '1'], 'Unknown flag'],
    [['--host', 'a:b:c', '--pin', '123456'], 'not a valid host'],
    [['--host', 'a:99999', '--pin', '123456'], 'not a valid host'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe('class-list codes', () => {
  it('reads column 1, skipping a header, blanks and repeats', () => {
    const csv = 'student_id,name\r\n101,Ada\n\n"102",Bob\n101,Again\n 103 ,Cy\n';
    expect(parseStudentCodes(csv)).toEqual(['101', '102', '103']);
  });

  it('keeps a first row that is a real ID', () => {
    expect(parseStudentCodes('7,Ada\n8,Bob')).toEqual(['7', '8']);
  });

  it('numbers students 1..N', () => {
    expect(numberedCodes(3)).toEqual(['1', '2', '3']);
  });
});

describe('runSim against a fake teacher', () => {
  let https: Server;
  let wss: WebSocketServer;
  let port: number;
  let hellos = 0;
  /** The clientSeq of every save the fake teacher received. */
  const seqs: number[] = [];
  let withQuestions = false;

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
          if (body.studentCode === 'nobody') {
            res.statusCode = 403;
            return res.end(JSON.stringify({ error: { code: 'not_on_list', message: 'no' } }));
          }
          return res.end(JSON.stringify({ token: `token-${body.studentCode}-`.padEnd(24, 'x') }));
        }
        res.end(JSON.stringify({ ok: true, state: 'lobby' }));
      });
    });
    wss = new WebSocketServer({ server: https, path: '/ws' });
    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString()) as {
          t: string;
          id?: string;
          clientSeq?: number;
        };
        if (message.t === 'hello') {
          hellos += 1;
          const state = withQuestions
            ? { questions: [{ id: 'q1', type: 'code', allowedLanguages: ['c'] }], saved: [] }
            : {};
          socket.send(JSON.stringify({ t: 'welcome', serverTime: Date.now(), state }));
        } else if (message.t === 'answer.save') {
          seqs.push(message.clientSeq ?? -1);
          socket.send(
            JSON.stringify({ t: 'answer.ack', id: message.id, clientSeq: message.clientSeq }),
          );
        }
      });
    });
    await new Promise<void>((resolve) => https.listen(0, '127.0.0.1', resolve));
    const address = https.address();
    port = typeof address === 'object' && address ? address.port : 0;
  });
  const drained = async (to: number) => {
    const end = Date.now() + 2000;
    while (wss.clients.size > to && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  };

  afterAll(() => {
    wss.close();
    https.close();
  });

  it('joins and connects every student, and reports one that is refused', async () => {
    const run = runSim(
      { host: '127.0.0.1', port, pin: '123456', rampMs: 0 },
      [...numberedCodes(25), 'nobody'],
      100,
    );
    await run.settled();
    expect(run.counts()).toMatchObject({ total: 26, connected: 25, failed: 1 });
    expect(run.failures().get('nobody')).toContain('not_on_list');
    expect(hellos).toBe(25);
    run.stop();
    await drained(0);
  });

  it('stop() closes the sockets', async () => {
    expect(wss.clients.size).toBe(0);
    const run = runSim({ host: '127.0.0.1', port, pin: '123456', rampMs: 0 }, ['a', 'b'], 100);
    await run.settled();
    expect(wss.clients.size).toBe(2);
    run.stop();
    await drained(0);
    expect(wss.clients.size).toBe(0);
  });

  it('saves answers once the exam has questions, and counts the acks', async () => {
    withQuestions = true;
    seqs.length = 0;
    const run = runSim(
      { host: '127.0.0.1', port, pin: '123456', rampMs: 0, autosaveMs: 100 },
      ['a', 'b', 'c'],
      100,
    );
    await run.settled();
    const end = Date.now() + 3000;
    while (run.saves().acked < 12 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    const saves = run.saves();
    expect(saves.acked).toBeGreaterThanOrEqual(12);
    expect(saves.sent).toBeGreaterThanOrEqual(saves.acked);
    expect(saves.sent - saves.acked).toBeLessThanOrEqual(3);
    // Each student counts 1, 2, 3...; three students, so every number repeats up to three times.
    expect(Math.min(...seqs)).toBe(1);
    run.stop();
    await drained(0);
    withQuestions = false;
  });
});

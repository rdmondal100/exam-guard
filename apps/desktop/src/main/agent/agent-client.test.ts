import net, { type Server, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PIPE_VERSION } from '@examguard/shared';
import { AgentClient, type AgentClientOptions } from './agent-client.js';
import { encodeFrame, FrameDecoder } from './pipe-frames.js';

let counter = 0;
const pipeName = () => `\\\\.\\pipe\\eg-client-test-${process.pid}-${counter++}`;

interface Conversation {
  socket: Socket;
  received: Record<string, unknown>[];
  send: (message: unknown) => void;
}

/** A scripted agent: lets each test decide what the "service" says. */
class ScriptedAgent {
  readonly name = pipeName();
  conversations: Conversation[] = [];
  private server: Server;
  onMessage: (message: Record<string, unknown>, c: Conversation) => void = () => undefined;

  constructor() {
    this.server = net.createServer((socket) => {
      const decoder = new FrameDecoder();
      const conversation: Conversation = {
        socket,
        received: [],
        send: (message) => socket.write(encodeFrame(message)),
      };
      this.conversations.push(conversation);
      socket.on('data', (chunk: Buffer) => {
        for (const message of decoder.push(chunk)) {
          const m = message as Record<string, unknown>;
          conversation.received.push(m);
          this.onMessage(m, conversation);
        }
      });
      socket.on('error', () => undefined);
    });
  }

  listen(): Promise<void> {
    return new Promise((resolve) => this.server.listen(this.name, resolve));
  }

  close(): Promise<void> {
    for (const c of this.conversations) c.socket.destroy();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

const hello = (pid = 4242, helper = true) => ({
  t: 'hello',
  seq: 1,
  pipeVersion: PIPE_VERSION,
  agentVersion: '0.0.0',
  pid,
  helper,
});
const checkResult = (reqSeq: number, over: Record<string, unknown> = {}) => ({
  t: 'system.check.result',
  seq: 5,
  reqSeq,
  ok: true,
  helper: true,
  captureOk: true,
  monitors: 2,
  problems: [],
  ...over,
});

async function until(what: string, condition: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

let agent: ScriptedAgent;
let client: AgentClient | null;
beforeEach(() => {
  agent = new ScriptedAgent();
  client = null;
});
afterEach(async () => {
  client?.stop();
  await agent.close();
});

const make = (over: Partial<AgentClientOptions> = {}): AgentClient => {
  client = new AgentClient({
    connect: () => net.connect(agent.name),
    verifyService: async (pid) => pid === 4242,
    appVersion: 'test',
    reconnectMinMs: 20,
    reconnectMaxMs: 60,
    recheckMs: 60_000,
    ...over,
  });
  return client;
};

/** Answers hello with hello and each system.check with a good result. */
function behaveLikeAgent(): void {
  agent.onMessage = (message, c) => {
    if (message['t'] === 'hello') c.send(hello());
    if (message['t'] === 'system.check') c.send(checkResult(message['seq'] as number));
  };
}

describe('AgentClient', () => {
  it('says hello, verifies the agent, runs the system check and becomes ok', async () => {
    await agent.listen();
    behaveLikeAgent();
    const link = make();
    expect(link.status().problems[0]).toMatch(/not running/);
    link.start();
    await until('ok', () => link.status().ok);
    expect(link.status()).toEqual({
      verified: true,
      ok: true,
      helper: true,
      captureOk: true,
      monitors: 2,
      problems: [],
    });
    expect(agent.conversations[0]?.received[0]).toMatchObject({
      t: 'hello',
      pipeVersion: PIPE_VERSION,
      appVersion: 'test',
    });
  });

  it('answers every heartbeat with an ack of the same hbSeq', async () => {
    await agent.listen();
    behaveLikeAgent();
    const link = make();
    link.start();
    await until('ok', () => link.status().ok);
    const c = agent.conversations[0];
    c?.send({ t: 'heartbeat', seq: 6, hbSeq: 0, helper: true, monitoring: false });
    c?.send({ t: 'heartbeat', seq: 7, hbSeq: 1, helper: true, monitoring: false });
    await until('acks', () => c?.received.filter((m) => m['t'] === 'heartbeat.ack').length === 2);
    expect(c?.received.filter((m) => m['t'] === 'heartbeat.ack').map((m) => m['hbSeq'])).toEqual([
      0, 1,
    ]);
  });

  it('rebuilds a hello that arrives a byte at a time', async () => {
    await agent.listen();
    agent.onMessage = (message, c) => {
      if (message['t'] === 'hello') {
        for (const byte of encodeFrame(hello())) c.socket.write(Buffer.from([byte]));
      }
      if (message['t'] === 'system.check') c.send(checkResult(message['seq'] as number));
    };
    const link = make();
    link.start();
    await until('ok', () => link.status().ok);
  });

  it('refuses an agent whose pid is not the installed service', async () => {
    await agent.listen();
    agent.onMessage = (message, c) => {
      if (message['t'] === 'hello') c.send(hello(31337));
    };
    const link = make();
    link.start();
    await until(
      'refused',
      () => link.status().problems[0] === 'This is not the ExamGuard monitoring agent.',
    );
    expect(link.status().verified).toBe(false);
    expect(link.status().ok).toBe(false);
  });

  it('reports a missing helper from the hello', async () => {
    await agent.listen();
    agent.onMessage = (message, c) => {
      if (message['t'] === 'hello') c.send(hello(4242, false));
    };
    const link = make();
    link.start();
    await until('verified', () => link.status().verified);
    expect(link.status()).toMatchObject({
      ok: false,
      helper: false,
      problems: ['The monitoring helper is not running.'],
    });
  });

  it('check() asks again and reports a black capture with its reason', async () => {
    await agent.listen();
    behaveLikeAgent();
    const link = make();
    link.start();
    await until('ok', () => link.status().ok);
    agent.onMessage = (message, c) => {
      if (message['t'] === 'system.check') {
        c.send(
          checkResult(message['seq'] as number, {
            ok: false,
            captureOk: false,
            problems: ['The monitoring agent cannot capture the screen.'],
          }),
        );
      }
    };
    const status = await link.check();
    expect(status).toMatchObject({ ok: false, captureOk: false, verified: true });
    expect(status.problems).toEqual(['The monitoring agent cannot capture the screen.']);
  });

  it('check() fails with a reason when the agent does not answer in time', async () => {
    await agent.listen();
    behaveLikeAgent();
    const link = make({ checkTimeoutMs: 80 });
    link.start();
    await until('ok', () => link.status().ok);
    agent.onMessage = () => undefined;
    const status = await link.check();
    expect(status.ok).toBe(false);
    expect(status.problems[0]).toMatch(/did not answer/);
  });

  it('check() on a link that is down just reports it', async () => {
    const link = make();
    expect((await link.check()).ok).toBe(false);
  });

  it('drops the link when the heartbeats stop and reconnects by itself', async () => {
    await agent.listen();
    behaveLikeAgent();
    const link = make({ lostAfterMs: 150 });
    link.start();
    await until('ok', () => link.status().ok);
    await until('lost and back', () => agent.conversations.length >= 2, 4000);
    expect(agent.conversations[0]?.socket.destroyed).toBe(true);
  });

  it('keeps trying until the agent appears, then tells listeners', async () => {
    const link = make();
    const seen: boolean[] = [];
    link.onChange((status) => seen.push(status.ok));
    link.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(link.status().ok).toBe(false);
    await agent.listen();
    behaveLikeAgent();
    await until('ok', () => link.status().ok);
    expect(seen.at(-1)).toBe(true);
  });

  describe('internet', () => {
    const netSets = (c: Conversation | undefined) =>
      (c?.received ?? []).filter((m) => m['t'] === 'net.set');
    /** Answers every net.set the way the real agent does, and acks heartbeats. */
    function behaveLikeAgentWithNet(fail?: string): void {
      agent.onMessage = (message, c) => {
        if (message['t'] === 'hello') c.send(hello());
        if (message['t'] === 'system.check') c.send(checkResult(message['seq'] as number));
        if (message['t'] === 'net.set') {
          const blocked = message['blocked'] === true && !fail;
          c.send({
            t: 'net.status',
            seq: 9,
            reqSeq: message['seq'],
            blocked,
            error: message['blocked'] === true ? (fail ?? null) : null,
          });
        }
      };
    }

    it('sends net.set once linked and reports what the agent confirmed', async () => {
      await agent.listen();
      behaveLikeAgentWithNet();
      const link = make();
      const seen: boolean[] = [];
      link.onInternet((o) => seen.push(o.blocked));
      link.start();
      await until('ok', () => link.status().ok);
      link.setInternet(true, ['192.168.1.10']);
      await until('blocked', () => link.internet().blocked);
      expect(netSets(agent.conversations[0])[0]).toMatchObject({
        t: 'net.set',
        blocked: true,
        allow: ['192.168.1.10'],
      });
      link.setInternet(false, []);
      await until('allowed', () => !link.internet().blocked);
      expect(seen).toEqual([true, false]);
    });

    it('asks again with every heartbeat while blocked, which is the lease', async () => {
      await agent.listen();
      behaveLikeAgentWithNet();
      const link = make();
      link.start();
      await until('ok', () => link.status().ok);
      link.setInternet(true, ['192.168.1.10']);
      await until('blocked', () => link.internet().blocked);
      const before = netSets(agent.conversations[0]).length;
      agent.conversations[0]?.send({
        t: 'heartbeat',
        seq: 3,
        hbSeq: 0,
        helper: true,
        monitoring: false,
      });
      agent.conversations[0]?.send({
        t: 'heartbeat',
        seq: 4,
        hbSeq: 1,
        helper: true,
        monitoring: false,
      });
      await until('renewals', () => netSets(agent.conversations[0]).length >= before + 2);
    });

    it('does not repeat an unblock with the heartbeats', async () => {
      await agent.listen();
      behaveLikeAgentWithNet();
      const link = make();
      link.start();
      await until('ok', () => link.status().ok);
      link.setInternet(false, []);
      await until('sent', () => netSets(agent.conversations[0]).length === 1);
      agent.conversations[0]?.send({
        t: 'heartbeat',
        seq: 3,
        hbSeq: 0,
        helper: true,
        monitoring: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(netSets(agent.conversations[0])).toHaveLength(1);
    });

    it('reports the agents reason when it cannot block', async () => {
      await agent.listen();
      behaveLikeAgentWithNet('access denied (0x00000005)');
      const link = make();
      link.start();
      await until('ok', () => link.status().ok);
      link.setInternet(true, ['192.168.1.10']);
      await until('error', () => link.internet().error !== null);
      expect(link.internet()).toEqual({ blocked: false, error: 'access denied (0x00000005)' });
    });

    it('says why at once when there is no agent, and sends the request once it appears', async () => {
      const link = make();
      link.setInternet(true, ['192.168.1.10']);
      expect(link.internet()).toEqual({
        blocked: false,
        error: 'The monitoring agent is not running.',
      });
      await agent.listen();
      behaveLikeAgentWithNet();
      link.start();
      await until('blocked', () => link.internet().blocked);
    });

    it('is not confirmed any more when the link is lost, and asks again when it is back', async () => {
      await agent.listen();
      behaveLikeAgentWithNet();
      const link = make();
      link.start();
      await until('ok', () => link.status().ok);
      link.setInternet(true, ['192.168.1.10']);
      await until('blocked', () => link.internet().blocked);
      agent.conversations[0]?.socket.destroy();
      await until('lost', () => !link.internet().blocked);
      expect(link.internet().error).toMatch(/stopped answering/);
      await until('blocked again', () => link.internet().blocked);
      expect(netSets(agent.conversations[1])).toHaveLength(1);
    });
  });

  describe('monitoring', () => {
    const policy = {
      screenshotOnSwitch: true,
      titleChangeShots: true,
      periodicOutsideSec: 20,
      minShotGapSec: 5,
      maxWidth: 1600,
      jpegQuality: 60,
    };
    const of = (c: Conversation | undefined, type: string) =>
      (c?.received ?? []).filter((m) => m['t'] === type);

    it('tells the agent the exam window and then to monitor, once linked', async () => {
      await agent.listen();
      behaveLikeAgent();
      const link = make();
      link.setExamWindow(66012, 4100);
      link.setMonitoring({ examStudentId: 's1', policy });
      link.start();
      await until('ok', () => link.status().ok);
      const received = agent.conversations[0]?.received.map((m) => m['t']) ?? [];
      expect(received.indexOf('exam.window')).toBeGreaterThan(0);
      expect(received.indexOf('monitor.start')).toBeGreaterThan(received.indexOf('exam.window'));
      expect(of(agent.conversations[0], 'exam.window')[0]).toMatchObject({
        hwnd: 66012,
        pid: 4100,
      });
      expect(of(agent.conversations[0], 'monitor.start')[0]).toMatchObject({
        examStudentId: 's1',
        policy,
      });
    });

    it('sends monitor.stop when monitoring ends and repeats the request after a reconnect', async () => {
      await agent.listen();
      behaveLikeAgent();
      const link = make();
      link.start();
      await until('ok', () => link.status().ok);
      link.setMonitoring({ examStudentId: 's1', policy });
      await until('start', () => of(agent.conversations[0], 'monitor.start').length === 1);
      agent.conversations[0]?.socket.destroy();
      await until('start again', () => of(agent.conversations[1], 'monitor.start').length === 1);
      link.setMonitoring(null);
      await until('stop', () => of(agent.conversations[1], 'monitor.stop').length === 1);
    });

    it('owes the agent a stop when monitoring ended while the link was down', async () => {
      await agent.listen();
      behaveLikeAgent();
      const link = make();
      link.start();
      await until('ok', () => link.status().ok);
      link.setMonitoring({ examStudentId: 's1', policy });
      await until('start', () => of(agent.conversations[0], 'monitor.start').length === 1);
      agent.conversations[0]?.socket.destroy();
      await until('down', () => !link.status().verified);
      link.setMonitoring(null);
      await until(
        'stop after reconnect',
        () => of(agent.conversations[1], 'monitor.stop').length === 1,
      );
      expect(of(agent.conversations[1], 'monitor.start')).toHaveLength(0);
    });

    it('says the request again when a heartbeat reports that monitoring is off', async () => {
      await agent.listen();
      behaveLikeAgent();
      const link = make();
      link.start();
      await until('ok', () => link.status().ok);
      link.setMonitoring({ examStudentId: 's1', policy });
      await until('start', () => of(agent.conversations[0], 'monitor.start').length === 1);
      agent.conversations[0]?.send({
        t: 'heartbeat',
        seq: 3,
        hbSeq: 0,
        helper: true,
        monitoring: false,
      });
      await until('start again', () => of(agent.conversations[0], 'monitor.start').length === 2);
      agent.conversations[0]?.send({
        t: 'heartbeat',
        seq: 4,
        hbSeq: 1,
        helper: true,
        monitoring: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(of(agent.conversations[0], 'monitor.start')).toHaveLength(2);
    });

    it('passes evidence on without the pipe fields and acks what the app confirmed', async () => {
      await agent.listen();
      behaveLikeAgent();
      const link = make();
      const seen: unknown[] = [];
      link.onEvidence((e) => seen.push(e));
      link.start();
      await until('ok', () => link.status().ok);
      agent.conversations[0]?.send({
        t: 'evidence',
        seq: 7,
        evidenceSeq: 1500,
        ts: 1_700_000_000_000,
        kind: 'focus_lost',
        data: { exe: 'chrome.exe', title: 'Google' },
        screenshot: { jpegBase64: '/9j/', width: 8, height: 4 },
      });
      await until('evidence', () => seen.length === 1);
      expect(seen[0]).toEqual({
        evidenceSeq: 1500,
        ts: 1_700_000_000_000,
        kind: 'focus_lost',
        data: { exe: 'chrome.exe', title: 'Google' },
        screenshot: { jpegBase64: '/9j/', width: 8, height: 4 },
      });
      link.ackEvidence(1500);
      await until('ack', () => of(agent.conversations[0], 'evidence.ack').length === 1);
      expect(of(agent.conversations[0], 'evidence.ack')[0]).toMatchObject({ upTo: 1500 });
    });
  });

  it('goes down and comes back when the service closes the pipe', async () => {
    await agent.listen();
    behaveLikeAgent();
    const link = make();
    link.start();
    await until('ok', () => link.status().ok);
    agent.conversations[0]?.socket.destroy();
    await until('down', () => !link.status().verified);
    await until('back', () => link.status().ok);
  });
});

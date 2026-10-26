import { describe, expect, it } from 'vitest';
import { DEFAULT_MONITORING, monitorPolicyFor, type SessionState } from '@examguard/shared';
import { FakeAgent } from '../agent/fake-agent.js';
import type { AgentEvidence } from '../agent/agent-link.js';
import { MonitorController, wantsMonitoring, type MonitorSession } from './monitor-controller.js';
import { hwndOf } from './exam-window.js';

const policy = monitorPolicyFor(DEFAULT_MONITORING);

const exam = (over: Partial<SessionState> = {}): SessionState => ({
  examState: 'running',
  studentState: 'active',
  deadline: 1,
  saved: [],
  locked: false,
  monitoring: true,
  monitoringPolicy: policy,
  terminal: { enabled: false, until: null },
  internet: 'allowed',
  filesEnabled: true,
  examFiles: [],
  ...over,
});

type Sent = Parameters<MonitorSession['sendEvidence']>;

class FakeSession implements MonitorSession {
  student: string | null = 's1';
  sent: { evidence: Sent[0]; ack: () => void }[] = [];
  examStudentId(): string | null {
    return this.student;
  }
  sendEvidence(evidence: Sent[0], onAcked: () => void): void {
    this.sent.push({ evidence, ack: onAcked });
  }
}

const evidence = (evidenceSeq: number, over: Partial<AgentEvidence> = {}): AgentEvidence => ({
  evidenceSeq,
  ts: 1000 + evidenceSeq,
  kind: 'focus_lost',
  data: { exe: 'chrome.exe', title: 'Google', pid: 7 },
  ...over,
});

function setup() {
  const agent = new FakeAgent();
  const session = new FakeSession();
  const controller = new MonitorController(agent, session);
  return { agent, session, controller };
}

describe('wantsMonitoring', () => {
  it('watches while the exam runs for an active or locked student', () => {
    expect(wantsMonitoring(exam())).toBe(true);
    expect(wantsMonitoring(exam({ studentState: 'locked' }))).toBe(true);
  });

  it('does not watch in the lobby, after submit, after the end or without a policy', () => {
    expect(wantsMonitoring(exam({ examState: 'hosting', studentState: 'lobby' }))).toBe(false);
    expect(wantsMonitoring(exam({ studentState: 'submitted' }))).toBe(false);
    expect(wantsMonitoring(exam({ studentState: 'ended_by_teacher' }))).toBe(false);
    expect(wantsMonitoring(exam({ examState: 'ended' }))).toBe(false);
    expect(wantsMonitoring(exam({ monitoring: false }))).toBe(false);
    const bare: Partial<SessionState> = exam();
    delete bare.monitoringPolicy;
    expect(wantsMonitoring(bare as SessionState)).toBe(false);
  });
});

describe('MonitorController', () => {
  it('starts the agent once with the policy and stops it on submit', () => {
    const { agent, controller } = setup();
    controller.onExam(exam());
    controller.onExam(exam());
    expect(agent.monitoring).toEqual({ examStudentId: 's1', policy });
    controller.onExam(exam({ studentState: 'submitted' }));
    expect(agent.monitoring).toBeNull();
  });

  it('does not start before the student is known', () => {
    const { agent, session, controller } = setup();
    session.student = null;
    controller.onExam(exam());
    expect(agent.monitoring).toBeNull();
  });

  it('restarts when the policy changes', () => {
    const { agent, controller } = setup();
    controller.onExam(exam());
    const changed = { ...policy, periodicOutsideSec: 60 };
    controller.onExam(exam({ monitoringPolicy: changed }));
    expect(agent.monitoring?.policy.periodicOutsideSec).toBe(60);
  });

  it('turns evidence into events with a stable key, details and the screenshot bytes', () => {
    const { agent, session, controller } = setup();
    controller.onExam(exam());
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    agent.emitEvidence(
      evidence(41, { screenshot: { jpegBase64: jpeg.toString('base64'), width: 8, height: 4 } }),
    );
    agent.emitEvidence(evidence(42, { kind: 'focus_returned', data: { durationMs: 5000 } }));
    expect(session.sent).toHaveLength(2);
    const [first, second] = session.sent;
    expect(first?.evidence).toMatchObject({
      key: 's1:41',
      type: 'focus_lost',
      clientTs: 1041,
      details: { exe: 'chrome.exe', title: 'Google', pid: 7 },
    });
    expect(Array.from(first?.evidence.jpeg ?? [])).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(second?.evidence.jpeg).toBeUndefined();
    expect(second?.evidence.details).toEqual({ durationMs: 5000 });
  });

  it('acks the agent only up to the point below which nothing is still waiting', () => {
    const { agent, session, controller } = setup();
    controller.onExam(exam());
    for (const seq of [1, 2, 3]) agent.emitEvidence(evidence(seq));
    session.sent[2]?.ack(); // 3 is stored first
    expect(agent.acked).toBe(0);
    session.sent[0]?.ack();
    expect(agent.acked).toBe(1);
    session.sent[1]?.ack();
    expect(agent.acked).toBe(3);
  });

  it('ignores what was acked already when the agent replays it', () => {
    const { agent, session, controller } = setup();
    controller.onExam(exam());
    agent.emitEvidence(evidence(5));
    session.sent[0]?.ack();
    agent.emitEvidence(evidence(5));
    expect(session.sent).toHaveLength(1);
  });

  it('still forwards what the agent saw just before it was stopped, until the session ends', () => {
    const { agent, session, controller } = setup();
    controller.onExam(exam());
    controller.onExam(exam({ studentState: 'submitted' }));
    agent.emitEvidence(evidence(9));
    expect(session.sent).toHaveLength(1);
    controller.reset();
    agent.emitEvidence(evidence(10));
    expect(session.sent).toHaveLength(1);
  });

  it('stops the agent when the session ends', () => {
    const { agent, controller } = setup();
    controller.onExam(exam());
    controller.reset();
    expect(agent.monitoring).toBeNull();
  });
});

describe('hwndOf', () => {
  it('reads a 64-bit and a 32-bit window handle', () => {
    const wide = Buffer.alloc(8);
    wide.writeBigUInt64LE(0x000a0b0cn);
    expect(hwndOf(wide)).toBe(0x000a0b0c);
    const narrow = Buffer.alloc(4);
    narrow.writeUInt32LE(66012);
    expect(hwndOf(narrow)).toBe(66012);
  });
});

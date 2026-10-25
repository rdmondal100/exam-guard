import { describe, expect, it } from 'vitest';
import type { AppEventType, SessionState } from '@examguard/shared';
import { FakeAgent } from '../agent/fake-agent.js';
import { InternetController, wantsBlock, type InternetSession } from './internet-controller.js';

const exam = (over: Partial<SessionState> = {}): SessionState => ({
  examState: 'running',
  studentState: 'active',
  deadline: 1,
  saved: [],
  locked: false,
  monitoring: false,
  terminal: { enabled: false, until: null },
  internet: 'blocked',
  filesEnabled: true,
  examFiles: [],
  ...over,
});

class FakeSession implements InternetSession {
  teacherAddress: string | null = '192.168.1.10';
  statuses: { blocked: boolean; error: string | null }[] = [];
  events: { type: AppEventType; details: Record<string, unknown> }[] = [];
  setInternetStatus(blocked: boolean, error: string | null): void {
    this.statuses.push({ blocked, error });
  }
  sendEvent(type: AppEventType, details: Record<string, unknown>): void {
    this.events.push({ type, details });
  }
}

describe('wantsBlock', () => {
  it('blocks only while the teacher says so and the student is still working', () => {
    expect(wantsBlock(exam())).toBe(true);
    expect(wantsBlock(exam({ examState: 'hosting', studentState: 'lobby' }))).toBe(true);
    expect(wantsBlock(exam({ internet: 'allowed' }))).toBe(false);
  });

  it('lifts the block on submit, on the teachers End and when the exam is over', () => {
    expect(wantsBlock(exam({ studentState: 'submitted' }))).toBe(false);
    expect(wantsBlock(exam({ studentState: 'ended_by_teacher' }))).toBe(false);
    expect(wantsBlock(exam({ examState: 'ended' }))).toBe(false);
    expect(wantsBlock(exam({ receipt: { hash: 'h', submittedAt: 1, answers: [] } as never }))).toBe(
      false,
    );
  });
});

function setup(failure: ConstructorParameters<typeof FakeAgent>[0] = null) {
  const agent = new FakeAgent(failure);
  const session = new FakeSession();
  const controller = new InternetController(agent, session);
  return { agent, session, controller };
}

describe('InternetController', () => {
  it('blocks through the agent, reports the confirmed state and logs one event', () => {
    const { agent, session, controller } = setup();
    controller.onExam(exam());
    controller.onExam(exam());
    expect(agent.internet()).toEqual({ blocked: true, error: null });
    expect(session.statuses).toEqual([{ blocked: true, error: null }]);
    expect(session.events).toEqual([
      { type: 'internet_blocked', details: { allow: '192.168.1.10' } },
    ]);
  });

  it('allows again when the teacher turns it back on', () => {
    const { agent, session, controller } = setup();
    controller.onExam(exam());
    controller.onExam(exam({ internet: 'allowed' }));
    expect(agent.internet().blocked).toBe(false);
    expect(session.statuses.at(-1)).toEqual({ blocked: false, error: null });
    expect(session.events.map((e) => e.type)).toEqual(['internet_blocked', 'internet_allowed']);
    expect(session.events[1]?.details).toEqual({ reason: 'teacher' });
  });

  it('lifts the block when the student submits', () => {
    const { agent, session, controller } = setup();
    controller.onExam(exam());
    controller.onExam(exam({ studentState: 'submitted' }));
    expect(agent.internet().blocked).toBe(false);
    expect(session.events.map((e) => e.type)).toEqual(['internet_blocked', 'internet_allowed']);
  });

  it('lifts the block when the session is left', () => {
    const { agent, controller } = setup();
    controller.onExam(exam());
    controller.reset();
    expect(agent.internet().blocked).toBe(false);
  });

  it('does nothing for an exam that never asked for a block', () => {
    const { session, controller } = setup();
    controller.onExam(exam({ internet: 'allowed' }));
    controller.reset();
    expect(session.statuses).toEqual([]);
    expect(session.events).toEqual([]);
  });

  it('reports a failed block once, with the reason, and no blocked event', () => {
    const { session, controller } = setup('down');
    controller.onExam(exam());
    controller.onExam(exam());
    expect(session.statuses).toEqual([
      { blocked: false, error: 'The monitoring agent is not running. (fake agent)' },
    ]);
    expect(session.events).toEqual([
      {
        type: 'internet_block_failed',
        details: { error: 'The monitoring agent is not running. (fake agent)' },
      },
    ]);
  });

  it('cannot block without the exam server address', () => {
    const { agent, session, controller } = setup();
    session.teacherAddress = null;
    controller.onExam(exam());
    expect(agent.internet().blocked).toBe(false);
    expect(session.events.map((e) => e.type)).toEqual(['internet_block_failed']);
  });
});

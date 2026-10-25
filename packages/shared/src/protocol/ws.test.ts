import { describe, expect, it } from 'vitest';
import {
  RosterUpdateSchema,
  ServerToStudentSchema,
  ServerToTeacherSchema,
  StudentMessageSchema,
  TeacherMessageSchema,
} from './ws.js';

const hello = {
  t: 'hello',
  token: 'a'.repeat(43),
  protocol: { major: 1, minor: 0 },
  resume: { lastServerSeq: 0 },
};

describe('student messages', () => {
  it('accepts hello and ping', () => {
    expect(StudentMessageSchema.safeParse(hello).success).toBe(true);
    expect(StudentMessageSchema.safeParse({ t: 'ping', clientSent: 5 }).success).toBe(true);
  });

  it('accepts an agent.status frame and rejects one with a missing field', () => {
    const status = { t: 'agent.status', ok: true, helper: true, captureOk: true, monitors: 2 };
    expect(StudentMessageSchema.safeParse(status).success).toBe(true);
    expect(StudentMessageSchema.safeParse({ ...status, monitors: undefined }).success).toBe(false);
  });

  it.each([
    { ...hello, token: 'short' },
    { ...hello, resume: { lastServerSeq: -1 } },
    { ...hello, protocol: { major: 'one', minor: 0 } },
    { t: 'unknown' },
    { t: 'ping' },
  ])('rejects %j', (message) => {
    expect(StudentMessageSchema.safeParse(message).success).toBe(false);
  });
});

describe('server messages', () => {
  it('parses welcome and pong', () => {
    const welcome = {
      t: 'welcome',
      serverTime: 1000,
      state: {
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
      },
    };
    expect(ServerToStudentSchema.safeParse(welcome).success).toBe(true);
    expect(
      ServerToStudentSchema.safeParse({ t: 'pong', clientSent: 1, serverTime: 2 }).success,
    ).toBe(true);
  });

  it('rejects a welcome with an unknown student state', () => {
    const bad = {
      t: 'welcome',
      serverTime: 1,
      state: {
        examState: 'hosting',
        studentState: 'banana',
        deadline: null,
        saved: [],
        locked: false,
        monitoring: false,
        terminal: { enabled: false, until: null },
        internet: 'allowed',
        filesEnabled: true,
        examFiles: [],
      },
    };
    expect(ServerToStudentSchema.safeParse(bad).success).toBe(false);
  });
});

describe('teacher messages', () => {
  const student = {
    id: 'es1',
    studentCode: '1',
    name: 'Ada',
    state: 'lobby',
    connected: true,
    riskScore: 0,
    outsideMs: 0,
    lastSeen: null,
    agentOk: true,
    internetBlocked: false,
  };

  it('accepts subscribe and rejects an empty exam id', () => {
    expect(TeacherMessageSchema.safeParse({ t: 'subscribe', examId: 'e1' }).success).toBe(true);
    expect(TeacherMessageSchema.safeParse({ t: 'subscribe', examId: '' }).success).toBe(false);
  });

  it('parses roster, hosting and notice pushes', () => {
    expect(RosterUpdateSchema.safeParse({ t: 'roster', students: [student] }).success).toBe(true);
    const counts = { joined: 1, inLobby: 1, active: 0, submitted: 0, connected: 1 };
    expect(ServerToTeacherSchema.safeParse({ t: 'hosting', ...counts }).success).toBe(true);
    expect(ServerToTeacherSchema.safeParse({ t: 'notice', level: 'warn', text: 'x' }).success).toBe(
      true,
    );
  });

  it('rejects a roster entry with a bad state', () => {
    expect(
      RosterUpdateSchema.safeParse({ t: 'roster', students: [{ ...student, state: 'x' }] }).success,
    ).toBe(false);
  });
});

describe('state update', () => {
  it('accepts a partial state with the running exam fields', () => {
    const update = {
      t: 'state',
      state: {
        examState: 'running',
        studentState: 'active',
        deadline: 1_700_000_000_000,
        questions: [
          {
            id: 'q1',
            position: 1,
            type: 'written',
            body: 'Explain',
            marks: 2,
            allowedLanguages: [],
            studentNote: '',
          },
        ],
      },
    };
    expect(ServerToStudentSchema.safeParse(update).success).toBe(true);
  });

  it('rejects an unknown exam state', () => {
    expect(
      ServerToStudentSchema.safeParse({ t: 'state', state: { examState: 'paused' } }).success,
    ).toBe(false);
  });
});

describe('events', () => {
  const event = {
    t: 'event',
    id: 'e1',
    dedupeKey: 'app:e1',
    clientTs: 1,
    type: 'run_executed',
    details: { language: 'c', status: 'ok' },
  };

  it('accepts an app event and its ack', () => {
    expect(StudentMessageSchema.safeParse(event).success).toBe(true);
    expect(ServerToStudentSchema.safeParse({ t: 'event.ack', id: 'e1' }).success).toBe(true);
  });

  it.each([
    { ...event, type: 'focus_lost' },
    { ...event, dedupeKey: '' },
    { ...event, details: 'x' },
  ])('rejects %j', (message) => {
    expect(StudentMessageSchema.safeParse(message).success).toBe(false);
  });
});

describe('answer saves', () => {
  const save = {
    t: 'answer.save',
    id: 'a1',
    clientSeq: 1,
    clientTs: 5,
    questionId: 'q1',
    language: 'c',
    content: 'int main(){}',
    selected: true,
    reason: 'interval',
  };

  it('accepts a save with or without flags, and its ack', () => {
    expect(StudentMessageSchema.safeParse(save).success).toBe(true);
    expect(StudentMessageSchema.safeParse({ ...save, flags: '-lm' }).success).toBe(true);
    expect(
      ServerToStudentSchema.safeParse({ t: 'answer.ack', id: 'a1', clientSeq: 1 }).success,
    ).toBe(true);
  });

  it.each([
    { ...save, clientSeq: 0 },
    { ...save, clientSeq: 1.5 },
    { ...save, reason: 'whenever' },
    { ...save, content: 'x'.repeat(128 * 1024 + 1) },
    { ...save, flags: 'x'.repeat(501) },
    { ...save, selected: 'yes' },
    { ...save, language: '' },
  ])('rejects %j', (message) => {
    expect(StudentMessageSchema.safeParse(message).success).toBe(false);
  });
});

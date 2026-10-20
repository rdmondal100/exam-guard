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

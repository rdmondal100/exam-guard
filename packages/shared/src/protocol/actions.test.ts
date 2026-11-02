import { describe, expect, it } from 'vitest';
import { ExamActionSchema, StudentActionSchema, TerminalLogResponseSchema } from './actions.js';
import { ServerToStudentSchema, StudentMessageSchema } from './ws.js';

describe('ExamActionSchema', () => {
  it('accepts terminal on, off and on for N minutes', () => {
    expect(ExamActionSchema.safeParse({ type: 'terminal', enabled: true }).success).toBe(true);
    expect(ExamActionSchema.safeParse({ type: 'terminal', enabled: false }).success).toBe(true);
    expect(
      ExamActionSchema.safeParse({ type: 'terminal', enabled: true, minutes: 30 }).success,
    ).toBe(true);
  });

  it.each([
    { type: 'terminal' },
    { type: 'terminal', enabled: true, minutes: 0 },
    { type: 'terminal', enabled: true, minutes: 1.5 },
    { type: 'terminal', enabled: true, minutes: 601 },
    { type: 'internet' },
    { type: 'internet', enabled: 'no' },
  ])('rejects %j', (action) => {
    expect(ExamActionSchema.safeParse(action).success).toBe(false);
  });
});

describe('internet messages', () => {
  it('accepts the internet action on and off', () => {
    expect(ExamActionSchema.safeParse({ type: 'internet', enabled: true }).success).toBe(true);
    expect(ExamActionSchema.safeParse({ type: 'internet', enabled: false }).success).toBe(true);
  });

  it('accepts the status a student sends and refuses a malformed one', () => {
    const ok = { t: 'internet.status', blocked: true, error: null };
    expect(StudentMessageSchema.safeParse(ok).success).toBe(true);
    expect(StudentMessageSchema.safeParse({ ...ok, error: 'denied' }).success).toBe(true);
    expect(StudentMessageSchema.safeParse({ t: 'internet.status', blocked: true }).success).toBe(
      false,
    );
    expect(StudentMessageSchema.safeParse({ ...ok, blocked: 'yes' }).success).toBe(false);
  });

  it('accepts the internet events the app reports', () => {
    for (const type of ['internet_blocked', 'internet_allowed', 'internet_block_failed']) {
      const event = { t: 'event', id: 'e', dedupeKey: 'e', clientTs: 1, type, details: {} };
      expect(StudentMessageSchema.safeParse(event).success).toBe(true);
    }
  });
});

describe('transcript messages', () => {
  it('accepts a chunk and its ack', () => {
    const chunk = { t: 'transcript', key: 'abc:1', clientTs: 1, text: 'PS> dir\r\n' };
    expect(StudentMessageSchema.safeParse(chunk).success).toBe(true);
    expect(ServerToStudentSchema.safeParse({ t: 'transcript.ack', key: 'abc:1' }).success).toBe(
      true,
    );
  });

  it('rejects a chunk over 16 KB', () => {
    const chunk = { t: 'transcript', key: 'k', clientTs: 1, text: 'x'.repeat(16 * 1024 + 1) };
    expect(StudentMessageSchema.safeParse(chunk).success).toBe(false);
  });

  it('accepts the terminal app events', () => {
    for (const type of ['terminal_opened', 'terminal_command', 'package_installed']) {
      const event = { t: 'event', id: '1', dedupeKey: '1', clientTs: 1, type, details: {} };
      expect(StudentMessageSchema.safeParse(event).success).toBe(true);
    }
  });
});

describe('TerminalLogResponseSchema', () => {
  it('parses events and a transcript', () => {
    const log = {
      events: [
        { id: 1, type: 'terminal_command', serverTs: 5, clientTs: 4, details: { line: 'dir' } },
      ],
      transcript: 'PS> dir',
      truncated: false,
    };
    expect(TerminalLogResponseSchema.parse(log)).toEqual(log);
  });
});

describe('student actions (M35)', () => {
  it('parses each action and refuses bad ones', () => {
    const ok = (a: object) => StudentActionSchema.safeParse(a).success;
    expect(ok({ type: 'unlock' })).toBe(true);
    expect(ok({ type: 'lock' })).toBe(true);
    expect(ok({ type: 'end' })).toBe(true);
    expect(ok({ type: 'reset_session' })).toBe(true);
    expect(ok({ type: 'extend', minutes: 10 })).toBe(true);
    expect(ok({ type: 'extend', minutes: 0 })).toBe(false);
    expect(ok({ type: 'extend', minutes: 1.5 })).toBe(false);
    expect(ok({ type: 'message', kind: 'warning', text: 'Eyes front' })).toBe(true);
    expect(ok({ type: 'message', kind: 'info', text: '  ' })).toBe(false);
    expect(ok({ type: 'message', kind: 'info', text: 'x'.repeat(501) })).toBe(false);
    // Unlock moved from the exam-wide actions to the student route.
    expect(ExamActionSchema.safeParse({ type: 'unlock', examStudentId: 's1' }).success).toBe(false);
  });

  it('carries teacher messages and acks over the student socket', () => {
    const message = { t: 'message', id: 'm', kind: 'info', text: 'Hi', sentAt: 1 };
    expect(ServerToStudentSchema.safeParse(message).success).toBe(true);
    expect(StudentMessageSchema.safeParse({ t: 'ack', id: 'm' }).success).toBe(true);
  });

  it('agent_lost is an app event', () => {
    const event = {
      t: 'event',
      id: 'e',
      dedupeKey: 'e',
      clientTs: 1,
      type: 'agent_lost',
      details: {},
    };
    expect(StudentMessageSchema.safeParse(event).success).toBe(true);
  });
});

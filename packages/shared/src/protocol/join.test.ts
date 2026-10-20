import { describe, expect, it } from 'vitest';
import {
  JOIN_CLIENT_ERROR_CODES,
  JOIN_ERROR_CODES,
  JoinAttemptSchema,
  JoinConfirmRequestSchema,
  JoinRequestSchema,
  JoinResultSchema,
} from './join.js';

const base = {
  studentCode: ' S1001 ',
  pin: '123456',
  deviceId: 'a'.repeat(64),
  protocol: { major: 1, minor: 0 },
  agent: { ok: true, helper: true, captureOk: true, monitors: 1 },
};

describe('JoinRequestSchema', () => {
  it('accepts a valid request and trims the student code', () => {
    const parsed = JoinRequestSchema.parse(base);
    expect(parsed.studentCode).toBe('S1001');
  });

  it.each(['12345', '1234567', 'abcdef', ''])('rejects the PIN %j', (pin) => {
    expect(JoinRequestSchema.safeParse({ ...base, pin }).success).toBe(false);
  });

  it('rejects a blank student code and a missing agent block', () => {
    expect(JoinRequestSchema.safeParse({ ...base, studentCode: '  ' }).success).toBe(false);
    expect(JoinRequestSchema.safeParse({ ...base, agent: undefined }).success).toBe(false);
  });
});

describe('JoinConfirmRequestSchema', () => {
  it('only accepts noticeAccepted: true', () => {
    expect(JoinConfirmRequestSchema.safeParse({ noticeAccepted: true }).success).toBe(true);
    expect(JoinConfirmRequestSchema.safeParse({ noticeAccepted: false }).success).toBe(false);
  });
});

describe('JoinAttemptSchema', () => {
  it('needs a 43-char fingerprint', () => {
    const attempt = {
      address: '192.168.1.5',
      port: 47820,
      fingerprint: 'A'.repeat(43),
      studentCode: 'S1',
      pin: '000000',
    };
    expect(JoinAttemptSchema.safeParse(attempt).success).toBe(true);
    expect(JoinAttemptSchema.safeParse({ ...attempt, fingerprint: 'short' }).success).toBe(false);
  });
});

describe('JoinResultSchema', () => {
  it('has no token field in the success shape', () => {
    const parsed = JoinResultSchema.parse({
      ok: true,
      examStudentId: 'x',
      name: 'Ada',
      examTitle: 'Midterm',
      token: 'leak',
    });
    expect('token' in parsed).toBe(false);
  });

  it('client codes include every server code', () => {
    for (const code of JOIN_ERROR_CODES) expect(JOIN_CLIENT_ERROR_CODES).toContain(code);
  });
});

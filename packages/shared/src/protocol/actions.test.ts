import { describe, expect, it } from 'vitest';
import { ExamActionSchema, TerminalLogResponseSchema } from './actions.js';
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
    { type: 'internet', enabled: false },
  ])('rejects %j', (action) => {
    expect(ExamActionSchema.safeParse(action).success).toBe(false);
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

import { describe, expect, it } from 'vitest';
import {
  ServerConfigMessageSchema,
  ServerReplyMessageSchema,
  ServerStatusSchema,
  TEACHER_API_PORT,
} from './server-host.js';

describe('ServerConfigMessageSchema', () => {
  it('fills the loopback defaults', () => {
    const msg = ServerConfigMessageSchema.parse({ type: 'config', token: 'a'.repeat(32) });
    expect(msg.host).toBe('127.0.0.1');
    expect(msg.port).toBe(TEACHER_API_PORT);
  });

  it('rejects a short token', () => {
    expect(ServerConfigMessageSchema.safeParse({ type: 'config', token: 'abc' }).success).toBe(
      false,
    );
  });
});

describe('ServerReplyMessageSchema', () => {
  it('accepts ready and error', () => {
    expect(ServerReplyMessageSchema.safeParse({ type: 'ready', port: 47821 }).success).toBe(true);
    expect(ServerReplyMessageSchema.safeParse({ type: 'error', message: 'x' }).success).toBe(true);
  });

  it('rejects unknown types', () => {
    expect(ServerReplyMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });
});

describe('ServerStatusSchema', () => {
  it('rejects an unknown state', () => {
    expect(
      ServerStatusSchema.safeParse({ state: 'weird', restartCount: 0, lastRestartAt: null })
        .success,
    ).toBe(false);
  });
});

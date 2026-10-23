import { describe, expect, it } from 'vitest';
import { AGENT_PIPE_NAME, AgentToAppSchema, AppToAgentSchema, PIPE_VERSION } from './agent-pipe.js';

describe('pipe name', () => {
  it('is the one the agent listens on', () => {
    expect(AGENT_PIPE_NAME).toBe(String.raw`\\.\pipe\examguard-agent`);
    expect(AGENT_PIPE_NAME.startsWith('\\\\.\\pipe\\')).toBe(true);
  });
});

describe('app → agent pipe messages', () => {
  it('accepts hello, system.check and heartbeat.ack', () => {
    const hello = { t: 'hello', seq: 1, pipeVersion: PIPE_VERSION, appVersion: '0.0.0' };
    expect(AppToAgentSchema.parse(hello).t).toBe('hello');
    expect(AppToAgentSchema.safeParse({ t: 'system.check', seq: 2 }).success).toBe(true);
    expect(AppToAgentSchema.safeParse({ t: 'heartbeat.ack', seq: 3, hbSeq: 7 }).success).toBe(true);
  });

  it('rejects an unknown type, another pipe version and a negative seq', () => {
    expect(AppToAgentSchema.safeParse({ t: 'monitor.start', seq: 1 }).success).toBe(false);
    const hello = { t: 'hello', seq: 1, pipeVersion: 2, appVersion: 'x' };
    expect(AppToAgentSchema.safeParse(hello).success).toBe(false);
    expect(AppToAgentSchema.safeParse({ t: 'system.check', seq: -1 }).success).toBe(false);
  });
});

describe('agent → app pipe messages', () => {
  it('accepts a hello with the service pid and a check result', () => {
    const hello = {
      t: 'hello',
      seq: 1,
      pipeVersion: 1,
      agentVersion: '0.0.0',
      pid: 412,
      helper: true,
    };
    expect(AgentToAppSchema.safeParse(hello).success).toBe(true);
    const result = {
      t: 'system.check.result',
      seq: 2,
      reqSeq: 5,
      ok: false,
      helper: true,
      captureOk: false,
      monitors: 0,
      problems: ['The screen capture is black.'],
    };
    expect(AgentToAppSchema.safeParse(result).success).toBe(true);
  });

  it('rejects a hello without a pid', () => {
    const hello = { t: 'hello', seq: 1, pipeVersion: 1, agentVersion: '0.0.0', helper: true };
    expect(AgentToAppSchema.safeParse(hello).success).toBe(false);
  });
});

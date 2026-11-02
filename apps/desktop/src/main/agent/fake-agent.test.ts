import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MONITORING, monitorPolicyFor, type AgentLinkStatus } from '@examguard/shared';
import { FakeAgent, parseFakeFailure, parseFakeMonitors } from './fake-agent.js';

afterEach(() => vi.useRealTimers());

describe('FakeAgent screens (M26)', () => {
  it('reports the screen count from EG_FAKE_AGENT_MONITORS, 1 when unset or odd', () => {
    expect(parseFakeMonitors('2')).toBe(2);
    expect(parseFakeMonitors(undefined)).toBe(1);
    expect(parseFakeMonitors('0')).toBe(1);
    expect(parseFakeMonitors('1.5')).toBe(1);
    expect(parseFakeMonitors('abc')).toBe(1);
    expect(new FakeAgent(null, 1000, 2).status().monitors).toBe(2);
    expect(new FakeAgent().status().monitors).toBe(1);
  });
});

describe('FakeAgent lose mode (M24)', () => {
  it('is healthy until monitoring starts, then goes down and tells listeners', () => {
    vi.useFakeTimers();
    expect(parseFakeFailure('lose')).toBe('lose');
    const agent = new FakeAgent('lose', 1000);
    const seen: AgentLinkStatus[] = [];
    agent.onChange((status) => seen.push(status));
    expect(agent.status().verified).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(seen).toEqual([]);
    agent.setMonitoring({ examStudentId: 's1', policy: monitorPolicyFor(DEFAULT_MONITORING) });
    vi.advanceTimersByTime(1000);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.verified).toBe(false);
    expect(agent.status().problems[0]).toMatch(/stopped answering/);
    agent.stop();
  });

  it('never goes down without the lose mode', () => {
    vi.useFakeTimers();
    const agent = new FakeAgent(null, 1000);
    agent.setMonitoring({ examStudentId: 's1', policy: monitorPolicyFor(DEFAULT_MONITORING) });
    vi.advanceTimersByTime(60_000);
    expect(agent.status().verified).toBe(true);
  });
});

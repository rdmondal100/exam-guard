import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentLinkStatus } from '@examguard/shared';
import { unlinked } from '../agent/agent-link.js';
import { createTamperLock } from './tamper-lock.js';

const healthy: AgentLinkStatus = {
  verified: true,
  ok: true,
  helper: true,
  captureOk: true,
  monitors: 1,
  problems: [],
};

afterEach(() => vi.useRealTimers());

describe('createTamperLock', () => {
  it('sends agent_lost and locks the window when the link stays down during the exam', () => {
    vi.useFakeTimers();
    let notify: (status: AgentLinkStatus) => void = () => undefined;
    const sent: [string, Record<string, unknown>][] = [];
    let locked = 0;
    const watch = createTamperLock(
      {
        status: () => healthy,
        onChange: (listener) => {
          notify = listener;
          return () => undefined;
        },
      },
      { sendEvent: (type, details) => sent.push([type, details]), lockLocally: () => locked++ },
    );
    watch.setWorking(true);
    notify(unlinked('The monitoring agent stopped answering.'));
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([
      ['agent_lost', { reason: 'The monitoring agent stopped answering.', downMs: 5000 }],
    ]);
    expect(locked).toBe(1);
    watch.dispose();
  });
});

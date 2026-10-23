import type { AgentLinkStatus } from '@examguard/shared';
import { unlinked, type AgentLink } from './agent-link.js';

/** `EG_FAKE_AGENT_FAIL`: which part of the fake agent reports a failure. */
export type FakeFailure = 'helper' | 'capture' | 'down' | null;

export function parseFakeFailure(value: string | undefined): FakeFailure {
  return value === 'helper' || value === 'capture' || value === 'down' ? value : null;
}

/**
 * Dev stand-in for the agent (`EG_FAKE_AGENT=1`): the same `AgentLink`, no Windows service, no
 * pipe. It reports a healthy agent unless `EG_FAKE_AGENT_FAIL` names a failure to try out.
 */
export class FakeAgent implements AgentLink {
  constructor(private readonly failure: FakeFailure = null) {}

  start(): void {}
  stop(): void {}

  status(): AgentLinkStatus {
    switch (this.failure) {
      case 'down':
        return unlinked('The monitoring agent is not running. (fake agent)');
      case 'helper':
        return {
          ...unlinked('The monitoring helper is not running. (fake agent)'),
          verified: true,
        };
      case 'capture':
        return {
          verified: true,
          ok: false,
          helper: true,
          captureOk: false,
          monitors: 1,
          problems: ['The monitoring agent cannot capture the screen. (fake agent)'],
        };
      default:
        return {
          verified: true,
          ok: true,
          helper: true,
          captureOk: true,
          monitors: 1,
          problems: [],
        };
    }
  }

  check(): Promise<AgentLinkStatus> {
    return Promise.resolve(this.status());
  }

  onChange(): () => void {
    return () => undefined;
  }
}

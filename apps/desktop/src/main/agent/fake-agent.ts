import type { AgentLinkStatus } from '@examguard/shared';
import { unlinked, type AgentLink, type InternetOutcome } from './agent-link.js';

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

  private net: InternetOutcome = { blocked: false, error: null };
  private netListeners = new Set<(outcome: InternetOutcome) => void>();

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

  /** Confirms at once and touches no network. `EG_FAKE_AGENT_FAIL=down` refuses, like a missing agent. */
  setInternet(blocked: boolean): void {
    const refused = blocked && this.failure === 'down';
    const outcome: InternetOutcome = refused
      ? { blocked: false, error: 'The monitoring agent is not running. (fake agent)' }
      : { blocked, error: null };
    if (outcome.blocked === this.net.blocked && outcome.error === this.net.error) return;
    this.net = outcome;
    for (const listener of this.netListeners) listener(outcome);
  }

  internet(): InternetOutcome {
    return this.net;
  }

  onInternet(listener: (outcome: InternetOutcome) => void): () => void {
    this.netListeners.add(listener);
    return () => this.netListeners.delete(listener);
  }
}

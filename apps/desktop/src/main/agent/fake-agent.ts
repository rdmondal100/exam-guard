import type { AgentLinkStatus } from '@examguard/shared';
import {
  unlinked,
  type AgentEvidence,
  type AgentLink,
  type InternetOutcome,
  type MonitoringRequest,
} from './agent-link.js';

/** `EG_FAKE_AGENT_FAIL`: which part of the fake agent reports a failure. */
export type FakeFailure = 'helper' | 'capture' | 'down' | 'lose' | null;

/** `EG_FAKE_AGENT_FAIL=lose`: how long after monitoring starts the fake link goes down. */
export const LOSE_AFTER_MS = 15_000;

export function parseFakeFailure(value: string | undefined): FakeFailure {
  return value === 'helper' || value === 'capture' || value === 'down' || value === 'lose'
    ? value
    : null;
}

/** `EG_FAKE_AGENT_MONITORS`: how many screens the fake reports (1–8, default 1; M26). */
export function parseFakeMonitors(value: string | undefined): number {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 8 ? count : 1;
}

/**
 * Dev stand-in for the agent (`EG_FAKE_AGENT=1`): the same `AgentLink`, no Windows service, no
 * pipe. It reports a healthy agent unless `EG_FAKE_AGENT_FAIL` names a failure to try out; `lose`
 * is healthy until monitoring starts and goes down `LOSE_AFTER_MS` later, to try the tamper lock (M24).
 */
export class FakeAgent implements AgentLink {
  constructor(
    private readonly failure: FakeFailure = null,
    private readonly loseAfterMs = LOSE_AFTER_MS,
    private readonly monitors = 1,
  ) {}

  /** `lose`: the link has gone down. */
  private lost = false;
  private loseTimer: NodeJS.Timeout | null = null;
  private changeListeners = new Set<(status: AgentLinkStatus) => void>();

  private net: InternetOutcome = { blocked: false, error: null };
  private netListeners = new Set<(outcome: InternetOutcome) => void>();

  start(): void {}
  stop(): void {
    if (this.loseTimer) clearTimeout(this.loseTimer);
    this.loseTimer = null;
  }

  status(): AgentLinkStatus {
    if (this.lost) return unlinked('The monitoring agent stopped answering. (fake agent)');
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
          monitors: this.monitors,
          problems: ['The monitoring agent cannot capture the screen. (fake agent)'],
        };
      default:
        return {
          verified: true,
          ok: true,
          helper: true,
          captureOk: true,
          monitors: this.monitors,
          problems: [],
        };
    }
  }

  check(): Promise<AgentLinkStatus> {
    return Promise.resolve(this.status());
  }

  onChange(listener: (status: AgentLinkStatus) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
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

  /** What the app last asked for; the fake watches nothing, so no evidence comes by itself. */
  monitoring: MonitoringRequest | null = null;
  examWindow: { hwnd: number; pid: number } | null = null;
  acked = 0;
  private evidenceListeners = new Set<(evidence: AgentEvidence) => void>();

  setMonitoring(request: MonitoringRequest | null): void {
    this.monitoring = request;
    if (request && this.failure === 'lose' && !this.loseTimer && !this.lost) {
      this.loseTimer = setTimeout(() => {
        this.lost = true;
        for (const listener of this.changeListeners) listener(this.status());
      }, this.loseAfterMs);
    }
  }

  setExamWindow(hwnd: number, pid: number): void {
    this.examWindow = { hwnd, pid };
  }

  onEvidence(listener: (evidence: AgentEvidence) => void): () => void {
    this.evidenceListeners.add(listener);
    return () => this.evidenceListeners.delete(listener);
  }

  ackEvidence(upTo: number): void {
    this.acked = Math.max(this.acked, upTo);
  }

  /** For tests and manual trials: pretend the agent saw something. */
  emitEvidence(evidence: AgentEvidence): void {
    for (const listener of this.evidenceListeners) listener(evidence);
  }
}

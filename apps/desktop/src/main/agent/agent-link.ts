import type { AgentLinkStatus, AgentStatus } from '@examguard/shared';

/**
 * The student app's link to the monitoring agent: the real pipe client, or the dev fake. The join
 * flow, the live socket and the agent gate only use this.
 */
export interface AgentLink {
  start(): void;
  stop(): void;
  /** What is known now, without asking the agent. */
  status(): AgentLinkStatus;
  /** Runs a fresh system check (a test capture) and returns the result. Never rejects. */
  check(): Promise<AgentLinkStatus>;
  /** Called when the status changes. Returns the function that stops listening. */
  onChange(listener: (status: AgentLinkStatus) => void): () => void;
}

/** A link that is down, with the reason in words for the student. */
export function unlinked(problem: string): AgentLinkStatus {
  return {
    verified: false,
    ok: false,
    helper: false,
    captureOk: false,
    monitors: 0,
    problems: [problem],
  };
}

export const NOT_RUNNING = 'The monitoring agent is not running.';

/** The block a join request and the live socket carry: the link's health as the server judges it. */
export function toAgentBlock(link: AgentLinkStatus): AgentStatus {
  return {
    ok: link.verified && link.ok,
    helper: link.helper,
    captureOk: link.captureOk,
    monitors: link.monitors,
  };
}

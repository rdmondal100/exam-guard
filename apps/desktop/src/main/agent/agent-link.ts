import type { AgentLinkStatus, AgentStatus, MonitorPolicy, PipeEvidence } from '@examguard/shared';

/** What the agent confirmed about the internet block (M21b). `error` says why a wanted block is not there. */
export interface InternetOutcome {
  blocked: boolean;
  error: string | null;
}

/** What the agent should watch for (M22). */
export interface MonitoringRequest {
  examStudentId: string;
  policy: MonitorPolicy;
}

/** The evidence as the agent sent it, without the pipe's own `seq`. */
export type AgentEvidence = Omit<PipeEvidence, 't' | 'seq'>;

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
  /**
   * Wants the internet blocked except `allow` (IPv4 addresses), or not blocked. The link keeps the
   * agent's lease alive while it is blocked and says what the agent confirmed through `onInternet`.
   */
  setInternet(blocked: boolean, allow: string[]): void;
  /** What the agent confirmed last. */
  internet(): InternetOutcome;
  /** Called when that changes. Returns the function that stops listening. */
  onInternet(listener: (outcome: InternetOutcome) => void): () => void;
  /**
   * Starts monitoring (the agent reports focus changes and screenshots), or stops it with `null`.
   * The link repeats the request to an agent that reconnects.
   */
  setMonitoring(request: MonitoringRequest | null): void;
  /** The exam window: the window id and process id the agent counts as inside the exam. */
  setExamWindow(hwnd: number, pid: number): void;
  /** Called for each piece of evidence, also again after a reconnect until it is acked. */
  onEvidence(listener: (evidence: AgentEvidence) => void): () => void;
  /** The server stored the evidence up to `upTo` (inclusive); the agent may forget it. */
  ackEvidence(upTo: number): void;
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

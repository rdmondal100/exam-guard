import { AGENT_LOST_LOCK_MS } from '@examguard/shared';

export interface AgentLoss {
  /** Why the link is down, in the agent client's words. */
  reason: string;
  /** How long it has been down. */
  downMs: number;
}

export interface TamperWatchOptions {
  onLost: (loss: AgentLoss) => void;
  lockAfterMs?: number;
  now?: () => number;
}

/**
 * The tamper lock's trigger (M24). While the exam runs for this student the agent link must be up;
 * one that stays down for `lockAfterMs` (from the drop, or from the start of working when it was
 * never up on this app run) is reported once. The same outage is not reported again, even after the
 * teacher unlocks: only a link that came back and was lost again counts as a new loss.
 */
export class TamperWatch {
  private working = false;
  private linked = false;
  private reason = '';
  private downSince: number | null = null;
  private reported = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly lockAfterMs: number;
  private readonly now: () => number;

  constructor(private readonly options: TamperWatchOptions) {
    this.lockAfterMs = options.lockAfterMs ?? AGENT_LOST_LOCK_MS;
    this.now = options.now ?? Date.now;
  }

  /** Whether the agent must be watching this student now (the exam runs and they still work). */
  setWorking(working: boolean): void {
    this.working = working;
    this.arm();
  }

  /** The agent link is verified and answering (`linked`), or why it is not. */
  setLinked(linked: boolean, reason = ''): void {
    if (linked) {
      this.linked = true;
      this.downSince = null;
      this.reported = false;
    } else {
      if (this.linked) this.downSince = this.now();
      this.linked = false;
      this.reason = reason;
    }
    this.arm();
  }

  dispose(): void {
    this.clear();
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(): void {
    this.clear();
    if (!this.working || this.linked || this.reported) return;
    const since = (this.downSince ??= this.now());
    const wait = Math.max(0, since + this.lockAfterMs - this.now());
    this.timer = setTimeout(() => this.fire(), wait);
  }

  private fire(): void {
    this.timer = null;
    if (!this.working || this.linked || this.reported || this.downSince === null) return;
    this.reported = true;
    this.options.onLost({ reason: this.reason, downMs: this.now() - this.downSince });
  }
}

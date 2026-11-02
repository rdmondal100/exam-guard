import type { PasteBlockedReport } from '@examguard/shared';

/** At most one `paste_blocked` event this often. */
export const PASTE_EVENT_GAP_MS = 2_000;

/**
 * Turns blocked pastes into `paste_blocked` events without flooding the teacher: the first one goes
 * at once, the ones in the next `gapMs` are folded into a single event at the end of that window
 * (the newest report, `suppressed` = how many others it stands for).
 */
export class PasteReporter {
  private windowOpen = false;
  private latest: PasteBlockedReport | null = null;
  private folded = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly send: (details: PasteBlockedReport) => void,
    private readonly gapMs = PASTE_EVENT_GAP_MS,
  ) {}

  report(report: PasteBlockedReport): void {
    if (!this.windowOpen) {
      this.send(report);
      this.open();
      return;
    }
    if (this.latest) this.folded += 1;
    this.latest = report;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private open(): void {
    this.windowOpen = true;
    this.timer = setTimeout(() => this.close(), this.gapMs);
  }

  private close(): void {
    this.timer = null;
    this.windowOpen = false;
    const latest = this.latest;
    if (!latest) return;
    const folded = this.folded;
    this.latest = null;
    this.folded = 0;
    this.send(folded > 0 ? { ...latest, suppressed: folded } : latest);
    this.open();
  }
}

import type { MonitorPolicy } from '@examguard/shared';
import type { FrontWindow } from './foreground.js';
import type { Site } from './site.js';

/** A window outside the exam as the policy sees it: the window and, for a browser, its site. */
export interface Seen {
  window: FrontWindow;
  site: Site | null;
}

export interface Observation {
  kind: 'focus_lost' | 'focus_returned' | 'title_changed' | 'still_outside';
  /** The outside window it is about (for `focus_returned`: the one that was left). */
  seen: Seen;
  /** `focus_returned`: how long the student was outside. */
  durationMs?: number;
  /** Take a screenshot now. */
  shot: boolean;
}

const sameSite = (a: Site | null, b: Site | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * When the monitor reports and takes a screenshot (architecture §3). Pure: the caller says what
 * the window in front is, whether it counts as inside the exam, and what time it is.
 *
 * A switch to another outside window is `focus_lost`; a new title (or site) in the same outside
 * window is `title_changed`; a timer while the student stays outside is `still_outside`; coming
 * back is `focus_returned` with the time away, counted from the first outside window. Each can
 * take a screenshot, at most one per `minShotGapSec`.
 */
export class SwitchPolicy {
  private seen: Seen | null = null;
  private outsideSince: number | null = null;
  private lastShot: number | null = null;

  constructor(private readonly policy: MonitorPolicy) {}

  /** One reading of the window in front; also once at the start. */
  observe(now: number, seen: Seen, inside: boolean): Observation[] {
    if (inside) return this.returned(now);
    const known = this.seen;
    if (known && known.window.windowId === seen.window.windowId) {
      if (known.window.title === seen.window.title && sameSite(known.site, seen.site)) return [];
      this.seen = seen;
      return [
        { kind: 'title_changed', seen, shot: this.allowShot(now, this.policy.titleChangeShots) },
      ];
    }
    this.outsideSince ??= now;
    this.seen = seen;
    return [
      { kind: 'focus_lost', seen, shot: this.allowShot(now, this.policy.screenshotOnSwitch) },
    ];
  }

  /** Call about once a second: the periodic shot while the student stays outside. */
  tick(now: number): Observation[] {
    const every = this.policy.periodicOutsideSec * 1000;
    if (every <= 0 || this.outsideSince === null || !this.seen) return [];
    const base = Math.max(this.lastShot ?? this.outsideSince, this.outsideSince);
    if (now - base < every || !this.allowShot(now, true)) return [];
    return [{ kind: 'still_outside', seen: this.seen, shot: true }];
  }

  /** Whether the student is outside the exam right now. */
  get outside(): boolean {
    return this.outsideSince !== null;
  }

  private returned(now: number): Observation[] {
    if (this.outsideSince === null || !this.seen) return [];
    const observation: Observation = {
      kind: 'focus_returned',
      seen: this.seen,
      durationMs: now - this.outsideSince,
      shot: false,
    };
    this.outsideSince = null;
    this.seen = null;
    return [observation];
  }

  /** Whether a screenshot may be taken now; remembers it when so. */
  private allowShot(now: number, wanted: boolean): boolean {
    if (!wanted) return false;
    if (this.lastShot !== null && now - this.lastShot < this.policy.minShotGapSec * 1000) {
      return false;
    }
    this.lastShot = now;
    return true;
  }
}

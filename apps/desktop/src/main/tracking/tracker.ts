import type { EvidenceDetails, EvidenceKind, MonitorPolicy } from '@examguard/shared';
import type { FrontWindow } from './foreground.js';
import { AppWatch, isTaskManager } from './openApps.js';
import { SwitchPolicy, type Observation, type Seen } from './policy.js';
import type { Site } from './site.js';
import { withTimeout } from '../utils/withTimeout.js';

/** A read of the window in front, or the window list, that takes longer is given up (M63). */
const READ_TIMEOUT_MS = 3000;
/** A screenshot that takes longer is given up; the event goes without it (M63). */
const CAPTURE_TIMEOUT_MS = 5000;
/** No read of the window in front has finished this long: the monitor is stalled (M63). */
const STALL_AFTER_MS = 15_000;

/** One thing the monitor saw, with its screenshot when the policy wanted one. */
export interface Evidence {
  kind: EvidenceKind;
  /** Unix ms on this PC. */
  ts: number;
  details: EvidenceDetails;
  jpeg?: Uint8Array;
}

export interface TrackerDeps {
  readFront: () => Promise<FrontWindow | null>;
  resolveSite: (window: FrontWindow) => Promise<Site | null>;
  listWindows: () => Promise<FrontWindow[]>;
  /** The exam app's windows and the student's own programs. */
  isInside: (window: FrontWindow) => boolean;
  capture: (policy: MonitorPolicy, near?: FrontWindow['bounds']) => Promise<Uint8Array | null>;
  screens: () => number;
  /** Calls back with the new screen count. Returns the function that stops listening. */
  watchScreens: (onChange: (count: number) => void) => () => void;
  /** Calls back when the lock screen comes up. Returns the function that stops listening. */
  watchLock: (onLock: () => void) => () => void;
  emit: (evidence: Evidence) => void;
  isAlive?: (pid: number) => boolean;
  now?: () => number;
  tickMs?: number;
  appsMs?: number;
  /** No window can be read this long: the secure desktop (Ctrl+Alt+Del, a UAC prompt). */
  secureAfterMs?: number;
  /** The watchdog (M63): called with `true` when the monitor stalls, `false` when it is back. */
  onStall?: (stalled: boolean) => void;
  stallAfterMs?: number;
  readTimeoutMs?: number;
}

const MAX_TITLE = 500;

function detailsOf({ window, site }: Seen): EvidenceDetails {
  return {
    exe: window.exe,
    path: window.path,
    pid: window.pid,
    title: window.title.slice(0, MAX_TITLE),
    ...site,
  };
}

interface Run {
  policy: MonitorPolicy;
  switches: SwitchPolicy;
  timers: NodeJS.Timeout[];
  unwatch: (() => void)[];
  screens: number;
  /** Since when no window in front could be read, and whether that was reported. */
  unreadableSince: number | null;
  secureShown: boolean;
  reading: boolean;
  listing: boolean;
  /** When a look at the window in front last finished (the watchdog's heartbeat, M63). */
  lastTickAt: number;
  /** Since when the monitor is stalled, or `null`. */
  stalledSince: number | null;
}

/**
 * The student app's monitor while the exam runs (requirements §8.5): reads the window in front
 * every second and the programs with a window every 2 s, follows the screens and the lock
 * screen, and turns what it sees into evidence with screenshots. It only observes and reports;
 * it never blocks, closes or changes anything on the PC.
 */
export class Tracker {
  private run: Run | null = null;
  /** Evidence goes out in the order it was seen, after its screenshot. */
  private chain: Promise<void> = Promise.resolve();
  private readonly apps: AppWatch;
  private readonly now: () => number;

  constructor(private readonly deps: TrackerDeps) {
    this.now = deps.now ?? Date.now;
    this.apps = new AppWatch({
      isOwn: deps.isInside,
      ...(deps.isAlive ? { isAlive: deps.isAlive } : {}),
    });
  }

  get running(): boolean {
    return this.run !== null;
  }

  /** Starts watching with the exam's policy (stops a run with another policy first). */
  start(policy: MonitorPolicy): void {
    this.stop();
    const run: Run = {
      policy,
      switches: new SwitchPolicy(policy),
      timers: [],
      unwatch: [],
      screens: this.deps.screens(),
      unreadableSince: null,
      secureShown: false,
      reading: false,
      listing: false,
      lastTickAt: this.now(),
      stalledSince: null,
    };
    this.run = run;
    if (run.screens > 1) this.report('monitor_changed', { monitors: run.screens });
    run.unwatch.push(
      this.deps.watchScreens((count) => {
        if (this.run !== run || count === run.screens) return;
        this.report('monitor_changed', { monitors: count, monitorsBefore: run.screens });
        run.screens = count;
      }),
      this.deps.watchLock(() => {
        if (this.run !== run || run.secureShown) return;
        run.secureShown = true;
        this.report('secure_desktop', { desktop: 'lock' });
      }),
    );
    void this.listApps(run, true);
    void this.readFront(run);
    run.timers.push(
      setInterval(() => void this.readFront(run), this.deps.tickMs ?? 1000),
      setInterval(() => void this.listApps(run, false), this.deps.appsMs ?? 2000),
      setInterval(() => this.watchdog(run), Math.min(5000, this.stallAfterMs / 3)),
    );
  }

  private get stallAfterMs(): number {
    return this.deps.stallAfterMs ?? STALL_AFTER_MS;
  }

  /**
   * The monitor's own health (M63): if no look at the window in front has finished for a while
   * (a Windows call hangs), the teacher is told at once instead of seeing silence.
   */
  private watchdog(run: Run): void {
    if (this.run !== run || run.stalledSince !== null) return;
    const now = this.now();
    if (now - run.lastTickAt < this.stallAfterMs) return;
    run.stalledSince = run.lastTickAt;
    this.report('monitor_stalled', { durationMs: now - run.lastTickAt });
    this.deps.onStall?.(true);
  }

  private ticked(run: Run): void {
    const now = this.now();
    run.lastTickAt = now;
    if (run.stalledSince === null) return;
    this.report('monitor_recovered', { durationMs: now - run.stalledSince });
    run.stalledSince = null;
    this.deps.onStall?.(false);
  }

  private timed<T>(promise: Promise<T>, label: string): Promise<T> {
    return withTimeout(promise, this.deps.readTimeoutMs ?? READ_TIMEOUT_MS, label);
  }

  /** Stops watching. What was seen before still goes out. */
  stop(): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    for (const timer of run.timers) clearInterval(timer);
    for (const unwatch of run.unwatch) unwatch();
  }

  /** Resolves when everything seen so far went out (tests). */
  settled(): Promise<void> {
    return this.chain;
  }

  private async readFront(run: Run): Promise<void> {
    if (run.reading) return; // A slow read skips a tick instead of piling up.
    run.reading = true;
    try {
      const window = await this.timed(this.deps.readFront(), 'Reading the window in front');
      if (this.run !== run) return;
      this.ticked(run);
      if (!window) return this.unreadable(run);
      run.unreadableSince = null;
      run.secureShown = false;
      const inside = this.deps.isInside(window);
      const site = inside
        ? null
        : await this.timed(this.deps.resolveSite(window), 'Reading the site').catch(() => null);
      if (this.run !== run) return;
      const now = this.now();
      this.deliver(run, [
        ...run.switches.observe(now, { window, site }, inside),
        ...run.switches.tick(now),
      ]);
    } catch {
      // A failed read is the same as nothing in front for this tick.
    } finally {
      run.reading = false;
    }
  }

  private unreadable(run: Run): void {
    const now = this.now();
    run.unreadableSince ??= now;
    if (!run.secureShown && now - run.unreadableSince >= (this.deps.secureAfterMs ?? 2000)) {
      run.secureShown = true;
      this.report('secure_desktop', { desktop: 'secure' });
    }
    this.deliver(run, run.switches.tick(now));
  }

  private async listApps(run: Run, first: boolean): Promise<void> {
    if (run.listing) return;
    run.listing = true;
    try {
      const windows = await this.timed(this.deps.listWindows(), 'Listing the windows');
      if (this.run !== run) return;
      if (first) {
        const processes = this.apps.start(windows).map(({ exe, pid }) => ({ exe, pid }));
        return this.report('processes_at_start', { processes });
      }
      for (const app of this.apps.next(windows)) {
        this.report(isTaskManager(app.exe) ? 'taskmgr_opened' : 'app_launched', app);
      }
    } catch {
      // Listing the windows failed; the next look catches up.
    } finally {
      run.listing = false;
    }
  }

  private report(kind: EvidenceKind, details: EvidenceDetails): void {
    const ts = this.now();
    this.chain = this.chain
      .then(() => this.deps.emit({ kind, ts, details }))
      // One failing step must not stop every later piece of evidence (M63).
      .catch(() => undefined);
  }

  private deliver(run: Run, observations: Observation[]): void {
    for (const observation of observations) {
      const ts = this.now();
      const details: EvidenceDetails = {
        ...detailsOf(observation.seen),
        ...(observation.durationMs !== undefined ? { durationMs: observation.durationMs } : {}),
      };
      this.chain = this.chain
        .then(async () => {
          // A capture that hangs (the secure desktop) is given up: the event goes without it.
          const jpeg = observation.shot
            ? await withTimeout(
                this.deps.capture(run.policy, observation.seen.window.bounds),
                CAPTURE_TIMEOUT_MS,
                'The screenshot',
              ).catch(() => null)
            : null;
          this.deps.emit({ kind: observation.kind, ts, details, ...(jpeg ? { jpeg } : {}) });
        })
        .catch(() => undefined);
    }
  }
}

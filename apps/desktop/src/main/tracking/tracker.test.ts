import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonitorPolicy } from '@examguard/shared';
import type { FrontWindow } from './foreground.js';
import type { Site } from './site.js';
import { Tracker, type Evidence, type TrackerDeps } from './tracker.js';

const POLICY: MonitorPolicy = {
  screenshotOnSwitch: true,
  titleChangeShots: true,
  periodicOutsideSec: 20,
  minShotGapSec: 5,
  maxWidth: 1600,
  jpegQuality: 60,
};
const EXAM_PID = 1;
const JPEG = new Uint8Array([0xff, 0xd8, 1]);

const win = (pid: number, exe: string, title = exe): FrontWindow => ({
  exe,
  path: `C:\\apps\\${exe}`,
  pid,
  windowId: pid * 10,
  title,
});
const exam = win(EXAM_PID, 'ExamGuard.exe');
const chrome = win(2, 'chrome.exe', 'ChatGPT');

let front: FrontWindow | null;
let windows: FrontWindow[];
let site: Site | null;
let screens: number;
let onScreens: (count: number) => void;
let onLock: () => void;
let seen: Evidence[];
let shots: { maxWidth: number; near: unknown }[];
let tracker: Tracker;

const deps = (): TrackerDeps => ({
  readFront: async () => front,
  resolveSite: async () => site,
  listWindows: async () => windows,
  isInside: (w) => w.pid === EXAM_PID,
  isAlive: () => true,
  capture: async (policy, near) => {
    shots.push({ maxWidth: policy.maxWidth, near });
    return JPEG;
  },
  screens: () => screens,
  watchScreens: (cb) => {
    onScreens = cb;
    return () => {};
  },
  watchLock: (cb) => {
    onLock = cb;
    return () => {};
  },
  emit: (e) => seen.push(e),
  now: () => Date.now(),
});

/** Lets the timers and the async reads run. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await tracker.settled();
}
const kinds = () => seen.map((e) => e.kind);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  front = exam;
  windows = [exam, win(3, 'Spotify.exe')];
  site = null;
  screens = 1;
  seen = [];
  shots = [];
  tracker = new Tracker(deps());
});
afterEach(() => {
  tracker.stop();
  vi.useRealTimers();
});

describe('Tracker', () => {
  it('lists the programs at the start and reports nothing while the student stays inside', async () => {
    tracker.start(POLICY);
    await advance(5000);
    expect(seen).toEqual([
      {
        kind: 'processes_at_start',
        ts: expect.any(Number),
        details: { processes: [{ exe: 'Spotify.exe', pid: 3 }] },
      },
    ]);
  });

  it('reports a switch to a browser with its site and a screenshot of its screen, then the return', async () => {
    tracker.start(POLICY);
    await advance(1000);
    front = { ...chrome, bounds: { x: 1920, y: 0, width: 800, height: 600 } };
    site = { domain: 'chatgpt.com', url: 'https://chatgpt.com/c/1' };
    await advance(1000);
    const lost = seen.find((e) => e.kind === 'focus_lost');
    expect(lost).toMatchObject({
      details: {
        exe: 'chrome.exe',
        title: 'ChatGPT',
        pid: 2,
        domain: 'chatgpt.com',
        url: 'https://chatgpt.com/c/1',
      },
      jpeg: JPEG,
    });
    expect(shots).toEqual([{ maxWidth: 1600, near: { x: 1920, y: 0, width: 800, height: 600 } }]);
    front = exam;
    await advance(3000);
    expect(seen.at(-1)).toMatchObject({ kind: 'focus_returned', details: { durationMs: 1000 } });
    expect(seen.at(-1)?.jpeg).toBeUndefined();
  });

  it('takes the periodic shot while the student stays away', async () => {
    front = chrome;
    tracker.start(POLICY);
    await advance(21_000);
    expect(kinds().filter((k) => k === 'still_outside')).toHaveLength(1);
  });

  it('reports a launch, Task Manager, screens and the lock screen', async () => {
    screens = 2;
    tracker.start(POLICY);
    await advance(1000);
    windows = [...windows, win(7, 'WhatsApp.exe'), win(8, 'Taskmgr.exe')];
    onScreens(3);
    onLock();
    await advance(2000);
    expect(seen).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'monitor_changed', details: { monitors: 2 } }),
        expect.objectContaining({
          kind: 'monitor_changed',
          details: { monitors: 3, monitorsBefore: 2 },
        }),
        expect.objectContaining({ kind: 'secure_desktop', details: { desktop: 'lock' } }),
        expect.objectContaining({
          kind: 'app_launched',
          details: expect.objectContaining({ exe: 'WhatsApp.exe' }),
        }),
        expect.objectContaining({
          kind: 'taskmgr_opened',
          details: expect.objectContaining({ exe: 'Taskmgr.exe' }),
        }),
      ]),
    );
  });

  it('reports the secure desktop once when no window can be read for a while', async () => {
    tracker.start(POLICY);
    await advance(1000);
    front = null;
    await advance(5000);
    expect(seen.filter((e) => e.kind === 'secure_desktop')).toEqual([
      expect.objectContaining({ details: { desktop: 'secure' } }),
    ]);
    front = exam;
    await advance(1000);
    front = null;
    await advance(3000);
    expect(kinds().filter((k) => k === 'secure_desktop')).toHaveLength(2);
  });

  it('stops watching, and a restart begins a new run', async () => {
    tracker.start(POLICY);
    await advance(1000);
    tracker.stop();
    expect(tracker.running).toBe(false);
    front = chrome;
    await advance(5000);
    expect(kinds()).toEqual(['processes_at_start']);
  });
});

describe('Tracker watchdog (M63)', () => {
  it('reports a stall when reading the window hangs, and the recovery after', async () => {
    let hang = true;
    const stalls: boolean[] = [];
    tracker = new Tracker({
      ...deps(),
      readFront: () => (hang ? new Promise<FrontWindow | null>(() => {}) : Promise.resolve(front)),
      onStall: (stalled) => stalls.push(stalled),
    });
    tracker.start(POLICY);
    await advance(20_000);
    expect(kinds()).toContain('monitor_stalled');
    expect(stalls).toEqual([true]);
    hang = false;
    await advance(5_000);
    expect(kinds()).toContain('monitor_recovered');
    expect(stalls).toEqual([true, false]);
    const recovered = seen.find((e) => e.kind === 'monitor_recovered');
    expect(recovered?.details.durationMs).toBeGreaterThan(15_000);
  });

  it('sends the event without its picture when the screenshot hangs', async () => {
    tracker = new Tracker({ ...deps(), capture: () => new Promise<Uint8Array | null>(() => {}) });
    tracker.start(POLICY);
    await advance(1500);
    front = chrome;
    await advance(7000);
    const lost = seen.find((e) => e.kind === 'focus_lost');
    expect(lost).toBeDefined();
    expect(lost?.jpeg).toBeUndefined();
  });
});

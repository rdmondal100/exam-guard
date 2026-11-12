import { describe, expect, it } from 'vitest';
import type { MonitorPolicy } from '@examguard/shared';
import type { FrontWindow } from './foreground.js';
import { SwitchPolicy, type Seen } from './policy.js';

const POLICY: MonitorPolicy = {
  screenshotOnSwitch: true,
  titleChangeShots: true,
  periodicOutsideSec: 20,
  minShotGapSec: 5,
  maxWidth: 1600,
  jpegQuality: 60,
};

const window = (windowId: number, exe: string, title: string): FrontWindow => ({
  exe,
  path: `C:\\apps\\${exe}`,
  pid: windowId * 10,
  windowId,
  title,
});
const seen = (w: FrontWindow, site: Seen['site'] = null): Seen => ({ window: w, site });
const S = 1000;

const exam = seen(window(1, 'ExamGuard.exe', 'ExamGuard'));
const chrome = seen(window(2, 'chrome.exe', 'Google'));
const notepad = seen(window(3, 'notepad.exe', 'notes.txt'));

describe('SwitchPolicy', () => {
  it('reports nothing while the student stays inside', () => {
    const p = new SwitchPolicy(POLICY);
    expect(p.observe(0, exam, true)).toEqual([]);
    expect(p.tick(60 * S)).toEqual([]);
  });

  it('a switch to another window is focus_lost with a shot', () => {
    const p = new SwitchPolicy(POLICY);
    expect(p.observe(0, chrome, false)).toEqual([{ kind: 'focus_lost', seen: chrome, shot: true }]);
    expect(p.outside).toBe(true);
    // The same window again is nothing new.
    expect(p.observe(1 * S, chrome, false)).toEqual([]);
  });

  it('a new title or site in the same window is title_changed, shots at most one per gap', () => {
    const p = new SwitchPolicy(POLICY);
    p.observe(0, chrome, false);
    const tab = seen({ ...chrome.window, title: 'ChatGPT' });
    expect(p.observe(2 * S, tab, false)).toEqual([
      { kind: 'title_changed', seen: tab, shot: false },
    ]);
    const site = seen(tab.window, { domain: 'chatgpt.com', url: 'https://chatgpt.com/' });
    expect(p.observe(6 * S, site, false)).toEqual([
      { kind: 'title_changed', seen: site, shot: true },
    ]);
  });

  it('every other outside window is a focus_lost of its own', () => {
    const p = new SwitchPolicy(POLICY);
    p.observe(0, chrome, false);
    expect(p.observe(10 * S, notepad, false)).toEqual([
      { kind: 'focus_lost', seen: notepad, shot: true },
    ]);
  });

  it('coming back reports the time away from the first outside window', () => {
    const p = new SwitchPolicy(POLICY);
    p.observe(0, chrome, false);
    p.observe(10 * S, notepad, false);
    expect(p.observe(25 * S, exam, true)).toEqual([
      { kind: 'focus_returned', seen: notepad, durationMs: 25 * S, shot: false },
    ]);
    expect(p.outside).toBe(false);
    expect(p.observe(26 * S, exam, true)).toEqual([]);
  });

  it('takes the periodic shot while the student stays outside', () => {
    const p = new SwitchPolicy(POLICY);
    p.observe(0, chrome, false);
    expect(p.tick(19 * S)).toEqual([]);
    expect(p.tick(20 * S)).toEqual([{ kind: 'still_outside', seen: chrome, shot: true }]);
    expect(p.tick(30 * S)).toEqual([]);
    expect(p.tick(40 * S)).toHaveLength(1);
  });

  it('follows the exam policy: no switch shots, no periodic shots', () => {
    const p = new SwitchPolicy({ ...POLICY, screenshotOnSwitch: false, periodicOutsideSec: 0 });
    expect(p.observe(0, chrome, false)).toEqual([
      { kind: 'focus_lost', seen: chrome, shot: false },
    ]);
    expect(p.tick(120 * S)).toEqual([]);
  });
});

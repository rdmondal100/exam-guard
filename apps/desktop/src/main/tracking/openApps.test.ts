import { describe, expect, it } from 'vitest';
import type { FrontWindow } from './foreground.js';
import { AppWatch, isTaskManager } from './openApps.js';

const win = (pid: number, exe: string, windowId = pid): FrontWindow => ({
  exe,
  path: `C:\\apps\\${exe}`,
  pid,
  windowId,
  title: exe,
});

describe('AppWatch', () => {
  it('lists the programs at the start once per process, without the exam app and Windows itself', () => {
    const watch = new AppWatch({ isOwn: (w) => w.pid === 1, isAlive: () => true });
    expect(
      watch.start([
        win(1, 'ExamGuard.exe'),
        win(2, 'chrome.exe'),
        win(2, 'chrome.exe', 20),
        win(3, 'explorer.exe'),
        win(4, 'Spotify.exe'),
      ]),
    ).toEqual([
      { exe: 'chrome.exe', path: 'C:\\apps\\chrome.exe', pid: 2 },
      { exe: 'Spotify.exe', path: 'C:\\apps\\Spotify.exe', pid: 4 },
    ]);
  });

  it('reports a program the first time it shows a window, and not again while it runs', () => {
    const alive = new Set([2, 5]);
    const watch = new AppWatch({ isOwn: () => false, isAlive: (pid) => alive.has(pid) });
    watch.start([win(2, 'chrome.exe')]);
    expect(watch.next([win(2, 'chrome.exe'), win(5, 'WhatsApp.exe')])).toEqual([
      { exe: 'WhatsApp.exe', path: 'C:\\apps\\WhatsApp.exe', pid: 5 },
    ]);
    // Its window hidden and shown again: no launch.
    expect(watch.next([win(2, 'chrome.exe')])).toEqual([]);
    expect(watch.next([win(5, 'WhatsApp.exe')])).toEqual([]);
    // Closed and started again with a new process: a launch.
    alive.delete(5);
    alive.add(6);
    expect(watch.next([win(6, 'WhatsApp.exe')])).toHaveLength(1);
  });

  it('knows Task Manager by its exe name', () => {
    expect(isTaskManager('Taskmgr.exe')).toBe(true);
    expect(isTaskManager('notepad.exe')).toBe(false);
  });
});

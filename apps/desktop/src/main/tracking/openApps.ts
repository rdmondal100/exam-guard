import { MAX_START_PROCESSES } from '@examguard/shared';
import type { FrontWindow } from './foreground.js';

/** A program with a window on the desktop. */
export interface OpenApp {
  exe: string;
  path: string;
  pid: number;
}

/**
 * Parts of Windows itself that show a window now and then (Start, search, the touch keyboard, the
 * lock screen). They run all the time, so they are never a launch.
 */
const SHELL = new Set(
  [
    'explorer.exe',
    'ShellExperienceHost.exe',
    'StartMenuExperienceHost.exe',
    'SearchHost.exe',
    'SearchApp.exe',
    'TextInputHost.exe',
    'LockApp.exe',
    'ShellHost.exe',
  ].map((exe) => exe.toLowerCase()),
);

/** Whether a process still runs (signal 0 only checks; EPERM means it runs as someone else). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface AppWatchDeps {
  /** The exam app and the student's own programs: never reported. */
  isOwn: (window: FrontWindow) => boolean;
  isAlive?: (pid: number) => boolean;
}

/**
 * Which programs have a window, by process: the first look gives the list at the start
 * (`processes_at_start`), every later look the programs whose first window appeared since
 * (`app_launched`). A program stays known while its process runs, so hiding and showing its
 * window again is no launch. Programs without any window (background tools) are not seen.
 */
export class AppWatch {
  private readonly known = new Set<number>();

  constructor(private readonly deps: AppWatchDeps) {}

  /** The first look: the programs running now, one entry per process. */
  start(windows: FrontWindow[]): OpenApp[] {
    this.known.clear();
    return this.take(windows).slice(0, MAX_START_PROCESSES);
  }

  /** A later look: the programs that opened their first window since the last one. */
  next(windows: FrontWindow[]): OpenApp[] {
    const alive = this.deps.isAlive ?? isAlive;
    for (const pid of [...this.known]) if (!alive(pid)) this.known.delete(pid);
    return this.take(windows);
  }

  private take(windows: FrontWindow[]): OpenApp[] {
    const found: OpenApp[] = [];
    for (const window of windows) {
      if (this.known.has(window.pid)) continue;
      this.known.add(window.pid);
      if (this.deps.isOwn(window) || SHELL.has(window.exe.toLowerCase())) continue;
      found.push({ exe: window.exe, path: window.path, pid: window.pid });
    }
    return found;
  }
}

/** Task Manager: its launch is reported as `taskmgr_opened` (requirements §8.5). */
export const isTaskManager = (exe: string) => exe.toLowerCase() === 'taskmgr.exe';

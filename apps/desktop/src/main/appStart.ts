import type { BrowserWindow } from 'electron';
import type { ExamLock } from './window/examLock.js';

/** What `index.ts` hands each app's start-up (M52). */
export interface StartContext {
  userData: string;
  examLock: ExamLock;
}

/** What an app's start-up hands back. */
export interface AppStart {
  /** The main window exists. */
  announceWindow?(window: BrowserWindow): void;
  /** The window is shown: start background work (the teacher's server). */
  afterWindow?(): void;
  /** The app is quitting and nothing blocks it. */
  onQuit?(): void;
}

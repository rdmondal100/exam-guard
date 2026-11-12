import { win32 } from 'node:path';
import type { FrontWindow } from './foreground.js';
import type { OwnProcesses } from './ownProcesses.js';

export interface InsideDeps {
  /** The exam app's own process: all its windows are the exam. */
  ownPid: number;
  /** The program of a run and the terminal's shell. */
  own: Pick<OwnProcesses, 'has'>;
  /** Folders whose programs are the student's own: the run folder and the bundled toolchains. */
  roots: () => (string | null)[];
}

/** Whether `path` is inside `root` (Windows paths, any letter case). */
export function isUnder(path: string, root: string): boolean {
  const folder = win32.normalize(root).toLowerCase().replace(/\\+$/, '');
  return win32.normalize(path).toLowerCase().startsWith(`${folder}\\`);
}

/**
 * Whether a window counts as inside the exam: one of the app's own, the student's running program
 * or terminal, or a program from the run folder or the toolchains (a GUI program the student
 * started from the terminal). Everything else is outside.
 */
export function createInsideCheck({ ownPid, own, roots }: InsideDeps) {
  return (window: FrontWindow): boolean => {
    if (window.pid === ownPid || own.has(window.pid)) return true;
    return roots().some((root) => root !== null && isUnder(window.path, root));
  };
}

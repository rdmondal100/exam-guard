import { execFile } from 'node:child_process';
import { ipcMain } from 'electron';
import type { SessionState } from '@examguard/shared';
import { IPC } from '../../../shared/ipcChannels.js';

/**
 * Whether the student may shut the PC down from the app (M57): only once their answers are safe on
 * the teacher's PC (a receipt) or the exam is over. Before that the button does not exist and
 * main refuses, so a click can never lose work.
 */
export function shutdownAllowed(exam: SessionState | null): boolean {
  if (!exam) return false;
  if (exam.receipt) return true;
  return ['ended', 'grading', 'in_review', 'finalized'].includes(exam.examState);
}

export type RunShutdown = () => Promise<void>;

/** `shutdown /s /t 5`: Windows' own shutdown, with five seconds for the app to close. */
const windowsShutdown: RunShutdown = () =>
  new Promise((resolve, reject) => {
    execFile('shutdown.exe', ['/s', '/t', '5'], { windowsHide: true }, (error) =>
      error ? reject(error) : resolve(),
    );
  });

export interface ShutdownIpcDeps {
  exam: () => SessionState | null;
  /** Events and terminal transcript not yet acked by the server (M60). */
  pendingEvidence?: () => number;
  run?: RunShutdown;
  /** How long to wait for unsent evidence before shutting down anyway. */
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The handler behind the receipt screen's "Shut down this PC" button. The monitor's last events
 * are given a few seconds to reach the teacher first (M60); a dead link does not keep the PC on.
 */
export async function handleShutdown({
  exam,
  pendingEvidence = () => 0,
  run = windowsShutdown,
  waitMs = 10_000,
  sleep = pause,
}: ShutdownIpcDeps) {
  if (!shutdownAllowed(exam())) {
    throw new Error('Submit your exam before you shut down this computer.');
  }
  for (let waited = 0; pendingEvidence() > 0 && waited < waitMs; waited += 250) await sleep(250);
  await run();
}

export function registerShutdownIpc(deps: ShutdownIpcDeps): void {
  ipcMain.handle(IPC.shutdownPc, () => handleShutdown(deps));
}

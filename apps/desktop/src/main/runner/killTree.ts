import { execFile } from 'node:child_process';

/** Ends a process and everything it started. Never throws; a process already gone is fine. */
export type KillTree = (pid: number) => void;

/**
 * `taskkill /T /F`: the whole tree under `pid`, so Stop, the time limit and closing the terminal
 * also end what the student's program or shell started (requirements §8.3). A program that
 * detached itself from the tree (`start` in cmd, `Start-Process`) survives; accepted limitation.
 */
export const killTree: KillTree = (pid) => {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
    return;
  }
  execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
};

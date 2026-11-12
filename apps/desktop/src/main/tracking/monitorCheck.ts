import type { MonitorStatus } from '@examguard/shared';
import type { FrontWindow } from './foreground.js';

export interface MonitorCheckDeps {
  /** A test capture of the screen. */
  capture: () => Promise<Uint8Array | null>;
  readFront: () => Promise<FrontWindow | null>;
  screens: () => number;
  /** Pause between reads of the window in front (tests pass 0). */
  retryMs?: number;
}

const READS = 3;

/**
 * The monitor's self-check before a student joins (and after a restart): the screen can be
 * captured, at least one screen is there, and the window in front can be read. The window is read
 * a few times, since a switch between two windows can leave none in front for a moment.
 */
export async function checkMonitor(deps: MonitorCheckDeps): Promise<MonitorStatus> {
  const shot = await deps.capture().catch(() => null);
  let front: FrontWindow | null = null;
  for (let i = 0; i < READS && !front; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, deps.retryMs ?? 150));
    front = await deps.readFront();
  }
  return {
    ok: front !== null,
    captureOk: shot !== null && shot.length > 0,
    monitors: deps.screens(),
  };
}

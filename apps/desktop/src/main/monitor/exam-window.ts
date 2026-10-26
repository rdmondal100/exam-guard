import type { AgentLink } from '../agent/agent-link.js';

/** The window handle Electron hands out is the native `HWND` as bytes in the machine's order. */
export function hwndOf(handle: Buffer): number {
  const value = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  return Number(value);
}

/** The part of a BrowserWindow the agent needs. */
export interface HasNativeHandle {
  getNativeWindowHandle(): Buffer;
}

/** Tells the agent which window and process are the exam, so it counts those as inside. */
export function announceExamWindow(
  link: Pick<AgentLink, 'setExamWindow'>,
  window: HasNativeHandle,
  pid: number,
): void {
  link.setExamWindow(hwndOf(window.getNativeWindowHandle()), pid);
}

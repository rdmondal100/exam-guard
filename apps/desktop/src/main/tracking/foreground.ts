import { win32 } from 'node:path';

/** A window on the desktop: its program (exe file name and path), process, handle and title. */
export interface FrontWindow {
  exe: string;
  path: string;
  pid: number;
  /** The window handle; get-windows' `id` on Windows. */
  windowId: number;
  title: string;
  /** Where the window is, in screen pixels (for the screenshot of its screen). */
  bounds?: { x: number; y: number; width: number; height: number };
}

/** The part of get-windows' result this app uses. */
export type RawWindow =
  | {
      id?: number;
      title?: string;
      owner?: { name?: string; path?: string; processId?: number };
      bounds?: { x: number; y: number; width: number; height: number };
    }
  | undefined;

export type ReadActiveWindow = () => Promise<RawWindow>;
export type ReadOpenWindows = () => Promise<RawWindow[]>;

// get-windows is ESM with a native binary, so it is loaded on first use.
const getWindows = () => import('get-windows');

export const readActiveWindow: ReadActiveWindow = async () => (await getWindows()).activeWindow();
export const readOpenWindows: ReadOpenWindows = async () => (await getWindows()).openWindows();

/** The program's exe file name (what the teacher's high-severity list uses) and the window. */
export function toFrontWindow(window: RawWindow): FrontWindow | null {
  const path = window?.owner?.path;
  const pid = window?.owner?.processId;
  if (!path || pid === undefined || window?.id === undefined) return null;
  const exe = win32.basename(path);
  if (!exe) return null;
  return {
    exe,
    path,
    pid,
    windowId: window.id,
    title: (window.title ?? '').trim(),
    ...(window.bounds ? { bounds: window.bounds } : {}),
  };
}

/**
 * The window in front, or `null` when none can be read: the lock screen or Ctrl+Alt+Del (the
 * secure desktop), a moment between two windows, or a closing process. Never throws.
 */
export async function readForeground(read: ReadActiveWindow = readActiveWindow) {
  try {
    return toFrontWindow(await read());
  } catch {
    return null;
  }
}

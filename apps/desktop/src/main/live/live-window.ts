import { join } from 'node:path';
import { BrowserWindow, app, desktopCapturer, ipcMain, screen } from 'electron';
import { LivePageMessageSchema, type LivePageMessage } from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import type { LivePeerWindow } from './live-views.js';

/** The webContents of live capture pages: the only pages that may capture the screen (window.ts). */
const liveContents = new Set<number>();

export function isLiveContents(id: number | undefined): boolean {
  return id !== undefined && liveContents.has(id);
}

const RENDERER_URL = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];

/** Messages from the capture pages, routed by the sender's webContents. */
const pageListeners = new Map<number, (message: LivePageMessage) => void>();
let ipcRegistered = false;

function registerPageIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on(IPC.livePage, (event, payload: unknown) => {
    const listener = pageListeners.get(event.sender.id);
    const parsed = LivePageMessageSchema.safeParse(payload);
    if (listener && parsed.success) listener(parsed.data);
  });
}

/** The primary screen's `desktopCapturer` source id (the same screen the thumbnails show). */
export async function primaryScreenSourceId(): Promise<string | null> {
  const primary = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
  });
  const source = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0];
  return source?.id ?? null;
}

/**
 * A hidden window that captures the screen and runs the student's peer connection (M34). It is a
 * child of the exam window, so it can never keep the app open, never shows and never takes focus.
 */
export function openLiveWindow(
  parent: BrowserWindow | null,
  onMessage: (message: LivePageMessage) => void,
  onGone: () => void,
): LivePeerWindow {
  registerPageIpc();
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    focusable: false,
    skipTaskbar: true,
    ...(parent ? { parent } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/live.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // A hidden page is throttled by default; the encoder must keep its frame rate.
      backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
  });
  const contentsId = win.webContents.id;
  liveContents.add(contentsId);
  pageListeners.set(contentsId, onMessage);
  let destroyed = false;
  let loaded = false;
  const queue: [string, unknown][] = [];
  const post = (channel: string, payload: unknown) => {
    if (destroyed) return;
    if (loaded) win.webContents.send(channel, payload);
    else queue.push([channel, payload]);
  };
  const cleanup = () => {
    liveContents.delete(contentsId);
    pageListeners.delete(contentsId);
  };
  win.webContents.on('did-finish-load', () => {
    loaded = true;
    for (const [channel, payload] of queue.splice(0)) win.webContents.send(channel, payload);
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('render-process-gone', () => {
    if (!destroyed) win.destroy();
  });
  win.on('closed', () => {
    cleanup();
    if (!destroyed) {
      destroyed = true;
      onGone();
    }
  });

  if (RENDERER_URL) void win.loadURL(new URL('live.html', `${RENDERER_URL}/`).href);
  else void win.loadFile(join(import.meta.dirname, '../renderer/live.html'));

  return {
    start: (start) => post(IPC.liveStart, start),
    signal: (data) => post(IPC.liveSignal, data),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      cleanup();
      // Destroying the page closes its peer connection and stops the capture.
      win.destroy();
    },
  };
}

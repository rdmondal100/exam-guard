import { join } from 'node:path';
import { BrowserWindow, app, session, shell } from 'electron';
import { TEACHER_API_HOST, TEACHER_API_PORT } from '@examguard/shared';

const RENDERER_URL = process.env['ELECTRON_RENDERER_URL'];
const TEACHER_API = `http://${TEACHER_API_HOST}:${TEACHER_API_PORT} ws://${TEACHER_API_HOST}:${TEACHER_API_PORT}`;

/** Dev needs the Vite server, its websocket and inline styles for HMR. */
function contentSecurityPolicy(): string {
  const dev = !app.isPackaged && RENDERER_URL;
  const origin = dev ? new URL(RENDERER_URL).host : '';
  return [
    "default-src 'self'",
    dev ? `script-src 'self' 'unsafe-inline'` : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    // Monaco runs its language services in blob: workers and ships its icon font as a data: URI.
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    // The teacher renderer calls the loopback server directly (architecture §2).
    dev
      ? `connect-src 'self' http://${origin} ws://${origin} ${TEACHER_API}`
      : `connect-src 'self' ${TEACHER_API}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function installCsp(): void {
  const policy = contentSecurityPolicy();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
    });
  });
}

export function createMainWindow(title: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!RENDERER_URL || !url.startsWith(RENDERER_URL)) event.preventDefault();
  });

  if (!app.isPackaged && RENDERER_URL) void win.loadURL(RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return win;
}

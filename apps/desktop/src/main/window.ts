import { join } from 'node:path';
import { BrowserWindow, app, session, shell } from 'electron';
import { TEACHER_API_HOST, TEACHER_API_PORT } from '@examguard/shared';

/** The Vite dev server; ignored in a packaged build, so the variable cannot point it elsewhere. */
const RENDERER_URL = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
const TEACHER_API = `http://${TEACHER_API_HOST}:${TEACHER_API_PORT} ws://${TEACHER_API_HOST}:${TEACHER_API_PORT}`;

/** Dev needs the Vite server, its websocket and inline styles for HMR. */
function contentSecurityPolicy(): string {
  const dev = !app.isPackaged && RENDERER_URL;
  const origin = dev ? new URL(RENDERER_URL).host : '';
  return [
    "default-src 'self'",
    dev ? `script-src 'self' 'unsafe-inline'` : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // Grid thumbnails arrive as binary frames and are shown through blob: URLs (M33).
    "img-src 'self' data: blob:",
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
  allowOnlyNeededPermissions();
}

/** What the page may ask for: Monaco's Copy (`navigator.clipboard.writeText`) and fullscreen. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

/**
 * Every other permission is refused (M49; Electron grants them all by default): camera,
 * microphone, notifications, geolocation, opening external links and so on. Above all the page
 * may not read the clipboard by itself (`navigator.clipboard.readText`): Monaco's menu Paste falls
 * back to it and would skip the paste guard (M25); Ctrl+V and the menu's `execCommand('paste')`
 * still work through the `paste` event the guard sees.
 */
function allowOnlyNeededPermissions(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));
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

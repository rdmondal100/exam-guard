import { app, ipcMain, type BrowserWindow } from 'electron';
import type { AppInfo } from '@examguard/shared';
import { IPC } from '../shared/ipcChannels.js';
import type { AppStart } from './appStart.js';
import { ExamLock } from './window/examLock.js';
import { DEFAULT_PROFILE, profileOrDefault, userDataPathFor } from './mode/profile.js';
import { applyStoredTheme, registerThemeIpc } from './settings/themeIpc.js';
import { createMainWindow, installCsp } from './window/mainWindow.js';

// The live view uses host candidates only (M34): Chromium would hide the LAN address behind an
// mDNS name, which many lab networks never resolve. Must be set before `ready`.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

// The profile must be applied before anything reads userData. It is a dev aid (two profiles on
// one PC): a packaged app ignores it, so a student cannot start a second, separate instance (M59).
const profile = app.isPackaged ? DEFAULT_PROFILE : profileOrDefault(process.argv);
const userData = userDataPathFor(app.getPath('userData'), profile);
app.setPath('userData', userData);

/** Which app this build is (M52); the other app's code is not in the bundle. */
const APP_NAME = __EG_APP__ === 'teacher' ? 'ExamGuard Teacher' : 'ExamGuard Student';

// One instance per profile (in dev, several profiles can run side by side).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let window: BrowserWindow | null = null;

  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(async () => {
    // EG_ALLOW_CLOSE is a dev escape hatch for the exam lock; a packaged app ignores it.
    const examLock = new ExamLock(!app.isPackaged && process.env['EG_ALLOW_CLOSE'] === '1');
    const info: AppInfo = { app: __EG_APP__, profile, version: app.getVersion() };
    ipcMain.handle(IPC.getInfo, () => info);
    registerThemeIpc(userData);

    // A constant branch with dynamic imports: Rollup drops the other app entirely.
    const started: AppStart =
      __EG_APP__ === 'teacher'
        ? (await import('./teacher/startTeacher.js')).startTeacher({ userData, examLock })
        : (await import('./student/startStudent.js')).startStudent({ userData, examLock });

    app.on('before-quit', (event) => {
      if (examLock.shouldBlockClose()) return event.preventDefault();
      started.onQuit?.();
    });
    installCsp();
    // Before the window opens, so the first paint already has the right colours.
    await applyStoredTheme(userData);
    window = createMainWindow(profile === DEFAULT_PROFILE ? APP_NAME : `${APP_NAME} (${profile})`);
    examLock.attach(window);
    started.announceWindow?.(window);
    started.afterWindow?.();
  });
}

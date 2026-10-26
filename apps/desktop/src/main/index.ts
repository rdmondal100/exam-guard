import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc-channels.js';
import { readInstallType } from './install-type.js';
import { ExamLock } from './exam-lock.js';
import { registerIpc, type AppState } from './ipc.js';
import { loadStoredMode, resolveMode } from './mode-store.js';
import { parseProfile, userDataPathFor } from './profile.js';
import { ServerHost } from './server-host.js';
import { createMainWindow, installCsp } from './window.js';

// The profile must be applied before anything reads userData.
const profile = parseProfile(process.argv);
const userData = userDataPathFor(app.getPath('userData'), profile);
app.setPath('userData', userData);

// One instance per profile, so a teacher and a student profile can run together.
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
    const installType = await readInstallType({
      override: process.env['EG_INSTALL_TYPE'],
      isPackaged: app.isPackaged,
    });
    const state: AppState = {
      profile,
      userData,
      installType,
      mode: resolveMode(installType, await loadStoredMode(userData)),
    };
    const server = new ServerHost(userData, join(userData, 'logs'), (status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.serverStatus, status);
      }
    });
    // EG_ALLOW_CLOSE is a dev escape hatch for the exam lock; a packaged app ignores it.
    const examLock = new ExamLock(!app.isPackaged && process.env['EG_ALLOW_CLOSE'] === '1');
    app.on('before-quit', (event) => {
      if (examLock.shouldBlockClose()) return event.preventDefault();
      server.stop();
    });
    const ipc = registerIpc(state, server, examLock);
    installCsp();
    window = createMainWindow(`ExamGuard AI (${profile})`);
    examLock.attach(window);
    ipc.announceWindow(window);
    if (state.mode === 'teacher') server.start();
  });
}

import { app, type BrowserWindow } from 'electron';
import { readInstallType } from './install-type.js';
import { registerIpc, type AppState } from './ipc.js';
import { loadStoredMode, resolveMode } from './mode-store.js';
import { parseProfile, userDataPathFor } from './profile.js';
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
    registerIpc(state);
    installCsp();
    window = createMainWindow(`ExamGuard AI (${profile})`);
  });
}

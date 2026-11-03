import { app, BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc-channels.js';
import { readInstallType } from './install-type.js';
import { ExamLock } from './exam-lock.js';
import { registerIpc, type AppState } from './ipc.js';
import { loadStoredMode, resolveMode } from './mode-store.js';
import { parseProfile, userDataPathFor } from './profile.js';
import { ServerHost } from './server-host.js';
import { createAiKeyStore } from './grading-key.js';
import { DataFolder } from './data-folder/data-folder.js';
import { registerDataFolderIpc } from './data-folder/data-folder-ipc.js';
import { DataFolderMover } from './data-folder/data-folder-mover.js';
import { registerExportsIpc } from './exports-ipc.js';
import { registerAiKeyIpc } from './settings/ai-key-ipc.js';
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
    // The teacher's data folder: the profile folder unless it was moved in Settings (M44).
    const dataFolder = new DataFolder(userData);
    const dataDir = () => dataFolder.current();
    const aiKeys = createAiKeyStore(dataDir);
    const server = new ServerHost(
      dataDir,
      (status) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.serverStatus, status);
        }
      },
      () => aiKeys.key(),
    );
    // EG_ALLOW_CLOSE is a dev escape hatch for the exam lock; a packaged app ignores it.
    const examLock = new ExamLock(!app.isPackaged && process.env['EG_ALLOW_CLOSE'] === '1');
    app.on('before-quit', (event) => {
      if (examLock.shouldBlockClose()) return event.preventDefault();
      server.stop();
    });
    const ipc = registerIpc(state, server, examLock);
    const isTeacher = () => state.mode === 'teacher';
    registerAiKeyIpc({ store: aiKeys, isTeacher });
    registerExportsIpc({ dataDir, isTeacher });
    registerDataFolderIpc({
      folder: dataFolder,
      mover: new DataFolderMover(dataFolder, server),
      isTeacher,
    });
    installCsp();
    window = createMainWindow(`ExamGuard AI (${profile})`);
    examLock.attach(window);
    ipc.announceWindow(window);
    if (state.mode === 'teacher') server.start();
  });
}

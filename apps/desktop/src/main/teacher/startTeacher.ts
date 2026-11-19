import { BrowserWindow, ipcMain } from 'electron';
import { IPC } from '../../shared/ipcChannels.js';
import type { AppStart, StartContext } from '../appStart.js';
import { ServerHost } from '../server/serverHost.js';
import { createAiKeyStore } from '../settings/gradingKey.js';
import { DataFolder } from '../dataFolder/dataFolder.js';
import { registerDataFolderIpc } from '../dataFolder/dataFolderIpc.js';
import { DataFolderMover } from '../dataFolder/dataFolderMover.js';
import { registerExportsIpc } from '../exports/exportsIpc.js';
import { registerAiKeyIpc } from '../settings/aiKeyIpc.js';

/**
 * The teacher app (M52): the exam server in a utilityProcess, the encrypted AI key, the data
 * folder and exports. Only this app contains the server.
 */
export function startTeacher({ userData }: StartContext): AppStart {
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
  ipcMain.handle(IPC.getServerConnection, () => server.getConnection());
  ipcMain.handle(IPC.getServerStatus, () => server.getStatus());
  const isTeacher = () => true;
  registerAiKeyIpc({ store: aiKeys, isTeacher });
  registerExportsIpc({ dataDir, isTeacher });
  registerDataFolderIpc({
    folder: dataFolder,
    mover: new DataFolderMover(dataFolder, server),
    isTeacher,
  });
  return {
    afterWindow: () => server.start(),
    onQuit: () => server.stop(),
  };
}

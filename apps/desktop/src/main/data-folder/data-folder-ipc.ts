import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import {
  DataFolderMoveRequestSchema,
  type DataFolderInfo,
  type DataFolderMoveResult,
} from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import type { DataFolder } from './data-folder.js';
import type { DataFolderMover } from './data-folder-mover.js';

interface DataFolderIpcDeps {
  folder: DataFolder;
  mover: DataFolderMover;
  isTeacher: () => boolean;
}

/**
 * Teacher mode (M44): show, open, choose and move the data folder. The server restarts during a
 * move, which signs the teacher out and unmounts Settings, so the outcome is also shown in a
 * native message box.
 */
export function registerDataFolderIpc({ folder, mover, isTeacher }: DataFolderIpcDeps): void {
  const guard = () => {
    if (!isTeacher()) throw new Error('The data folder is for Teacher mode');
  };
  ipcMain.handle(IPC.dataFolderInfo, (): DataFolderInfo => {
    guard();
    return folder.info();
  });
  ipcMain.handle(IPC.dataFolderOpen, async () => {
    guard();
    await shell.openPath(folder.current());
  });
  ipcMain.handle(IPC.dataFolderChoose, async (event): Promise<string | null> => {
    guard();
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Move the data folder to',
      properties: ['openDirectory', 'createDirectory'],
    };
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC.dataFolderMove, async (event, payload: unknown) => {
    guard();
    const { path } = DataFolderMoveRequestSchema.parse(payload);
    const result: DataFolderMoveResult = await mover.move(path);
    const window = BrowserWindow.fromWebContents(event.sender);
    const box: Electron.MessageBoxOptions = result.ok
      ? {
          type: 'info',
          title: 'Data folder moved',
          message: `The data is now in ${result.path}. Sign in again.`,
          ...(result.leftBehind > 0
            ? { detail: 'Some old files could not be deleted. You can delete them yourself.' }
            : {}),
        }
      : { type: 'error', title: 'Data folder not moved', message: result.message };
    if (window) await dialog.showMessageBox(window, box);
    return result;
  });
}

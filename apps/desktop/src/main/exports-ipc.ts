import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ipcMain, shell } from 'electron';
import { RevealExportRequestSchema } from '@examguard/shared';
import { IPC } from '../shared/ipc-channels.js';

interface ExportsIpcDeps {
  /** The data folder (it can move, M44); the server writes exports to `<dataDir>/exports`. */
  dataDir: () => string;
  isTeacher: () => boolean;
}

/** Teacher mode (M42): "Show in folder" for a results CSV the server saved. */
export function registerExportsIpc({ dataDir, isTeacher }: ExportsIpcDeps): void {
  ipcMain.handle(IPC.revealExport, (_event, payload: unknown) => {
    if (!isTeacher()) throw new Error('Exports are for Teacher mode');
    const { fileName } = RevealExportRequestSchema.parse(payload);
    const path = join(dataDir(), 'exports', fileName);
    if (!existsSync(path)) return false;
    shell.showItemInFolder(path);
    return true;
  });
}

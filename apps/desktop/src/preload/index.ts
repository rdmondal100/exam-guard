import { contextBridge, ipcRenderer } from 'electron';
import { AppInfoSchema, type AppMode } from '@examguard/shared';
import { IPC } from '../shared/ipc-channels.js';
import type { ExamGuardApi } from './api.js';

const api: ExamGuardApi = {
  getInfo: async () => AppInfoSchema.parse(await ipcRenderer.invoke(IPC.getInfo)),
  setMode: async (mode: AppMode) =>
    AppInfoSchema.parse(await ipcRenderer.invoke(IPC.setMode, { mode })),
};

contextBridge.exposeInMainWorld('examguard', api);

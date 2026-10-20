import { BrowserWindow, ipcMain } from 'electron';
import {
  ProbeRequestSchema,
  SetModeRequestSchema,
  allowedModesFor,
  type AppInfo,
  type AppMode,
  type InstallType,
} from '@examguard/shared';
import { IPC } from '../shared/ipc-channels.js';
import { Discovery } from './discovery.js';
import { probeHost } from './probe-host.js';
import { resolveMode, saveStoredMode } from './mode-store.js';
import type { ServerHost } from './server-host.js';

export interface AppState {
  profile: string;
  userData: string;
  installType: InstallType;
  mode: AppMode | null;
}

function toInfo(state: AppState): AppInfo {
  return {
    mode: state.mode,
    installType: state.installType,
    allowedModes: allowedModesFor(state.installType),
    profile: state.profile,
  };
}

export function registerIpc(state: AppState, server: ServerHost): void {
  const discovery = new Discovery((hosts) => {
    for (const win of BrowserWindow.getAllWindows())
      win.webContents.send(IPC.discoveryHosts, hosts);
  });
  const requireStudent = () => {
    if (state.mode !== 'student') throw new Error('Discovery is for Student mode');
  };
  ipcMain.handle(IPC.getInfo, () => toInfo(state));
  ipcMain.handle(IPC.getServerConnection, () => server.getConnection());
  ipcMain.handle(IPC.getServerStatus, () => server.getStatus());

  ipcMain.handle(IPC.startDiscovery, () => {
    requireStudent();
    discovery.start();
    return discovery.list();
  });
  ipcMain.handle(IPC.stopDiscovery, () => discovery.stop());
  ipcMain.handle(IPC.probeHost, (_event, payload: unknown) => {
    requireStudent();
    return probeHost(ProbeRequestSchema.parse(payload));
  });

  ipcMain.handle(IPC.setMode, async (_event, payload: unknown) => {
    const request = SetModeRequestSchema.parse(payload);
    if (!allowedModesFor(state.installType).includes(request.mode)) {
      throw new Error(`Mode "${request.mode}" is not allowed on this install`);
    }
    await saveStoredMode(state.userData, request.mode);
    state.mode = resolveMode(state.installType, request.mode);
    if (state.mode === 'teacher') server.start();
    return toInfo(state);
  });
}

import { ipcMain } from 'electron';
import {
  SetModeRequestSchema,
  allowedModesFor,
  type AppInfo,
  type AppMode,
  type InstallType,
} from '@examguard/shared';
import { IPC } from '../shared/ipc-channels.js';
import { resolveMode, saveStoredMode } from './mode-store.js';

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

export function registerIpc(state: AppState): void {
  ipcMain.handle(IPC.getInfo, () => toInfo(state));

  ipcMain.handle(IPC.setMode, async (_event, payload: unknown) => {
    const request = SetModeRequestSchema.parse(payload);
    if (!allowedModesFor(state.installType).includes(request.mode)) {
      throw new Error(`Mode "${request.mode}" is not allowed on this install`);
    }
    await saveStoredMode(state.userData, request.mode);
    state.mode = resolveMode(state.installType, request.mode);
    return toInfo(state);
  });
}

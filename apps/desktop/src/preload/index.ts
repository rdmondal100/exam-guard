import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  AppInfoSchema,
  DiscoveredHostSchema,
  JoinAttemptSchema,
  JoinConfirmResultSchema,
  JoinResultSchema,
  ProbeRequestSchema,
  ProbeResultSchema,
  ServerConnectionSchema,
  ServerStatusSchema,
  type AppMode,
  type ServerStatus,
} from '@examguard/shared';
import { IPC } from '../shared/ipc-channels.js';
import type { ExamGuardApi } from './api.js';

const api: ExamGuardApi = {
  getInfo: async () => AppInfoSchema.parse(await ipcRenderer.invoke(IPC.getInfo)),
  setMode: async (mode: AppMode) =>
    AppInfoSchema.parse(await ipcRenderer.invoke(IPC.setMode, { mode })),
  getServerConnection: async () =>
    ServerConnectionSchema.nullable().parse(await ipcRenderer.invoke(IPC.getServerConnection)),
  getServerStatus: async () =>
    ServerStatusSchema.parse(await ipcRenderer.invoke(IPC.getServerStatus)),
  onServerStatus: (listener: (status: ServerStatus) => void) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      const parsed = ServerStatusSchema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(IPC.serverStatus, handler);
    return () => ipcRenderer.removeListener(IPC.serverStatus, handler);
  },
  startDiscovery: async () =>
    DiscoveredHostSchema.array().parse(await ipcRenderer.invoke(IPC.startDiscovery)),
  stopDiscovery: async () => {
    await ipcRenderer.invoke(IPC.stopDiscovery);
  },
  onDiscoveryHosts: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      const parsed = DiscoveredHostSchema.array().safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(IPC.discoveryHosts, handler);
    return () => ipcRenderer.removeListener(IPC.discoveryHosts, handler);
  },
  probeHost: async (request) =>
    ProbeResultSchema.parse(
      await ipcRenderer.invoke(IPC.probeHost, ProbeRequestSchema.parse(request)),
    ),
  joinExam: async (attempt) =>
    JoinResultSchema.parse(
      await ipcRenderer.invoke(IPC.joinExam, JoinAttemptSchema.parse(attempt)),
    ),
  confirmJoin: async () => JoinConfirmResultSchema.parse(await ipcRenderer.invoke(IPC.confirmJoin)),
};

contextBridge.exposeInMainWorld('examguard', api);

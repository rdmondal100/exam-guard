import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { z } from 'zod';
import {
  AppInfoSchema,
  DiscoveredHostSchema,
  ExamFilesStatusSchema,
  FileCreateRequestSchema,
  FilePathSchema,
  FileReadResultSchema,
  FileRenameRequestSchema,
  FileWriteRequestSchema,
  FilesListRequestSchema,
  FilesListSchema,
  filesResultSchema,
  JoinAttemptSchema,
  JoinConfirmResultSchema,
  JoinResultSchema,
  ProbeRequestSchema,
  ProbeResultSchema,
  RunInputSchema,
  RunRequestSchema,
  RunResultSchema,
  RunSizeSchema,
  ServerConnectionSchema,
  ServerStatusSchema,
  SessionStateSchema,
  SessionStatusSchema,
  TerminalDataSchema,
  TerminalExitSchema,
  TerminalInputSchema,
  TerminalOpenResultSchema,
  TerminalSizeSchema,
  TerminalStatusSchema,
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
  startSession: async () => {
    await ipcRenderer.invoke(IPC.startSession);
  },
  onSessionStatus: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      const parsed = SessionStatusSchema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(IPC.sessionStatus, handler);
    return () => ipcRenderer.removeListener(IPC.sessionStatus, handler);
  },
  onSessionExam: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      const parsed = SessionStateSchema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(IPC.sessionExam, handler);
    return () => ipcRenderer.removeListener(IPC.sessionExam, handler);
  },
  runCode: async (request) =>
    RunResultSchema.parse(await ipcRenderer.invoke(IPC.runCode, RunRequestSchema.parse(request))),
  stopRun: async () => {
    await ipcRenderer.invoke(IPC.stopRun);
  },
  runInput: (data) => ipcRenderer.send(IPC.runInput, RunInputSchema.parse(data)),
  resizeRun: (size) => ipcRenderer.send(IPC.runResize, RunSizeSchema.parse(size)),
  onRunData: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      const parsed = TerminalDataSchema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(IPC.runData, handler);
    return () => ipcRenderer.removeListener(IPC.runData, handler);
  },
  filesList: async (request) =>
    filesResultSchema(FilesListSchema).parse(
      await ipcRenderer.invoke(IPC.filesList, FilesListRequestSchema.parse(request)),
    ),
  filesRead: async (path) =>
    filesResultSchema(FileReadResultSchema).parse(
      await ipcRenderer.invoke(IPC.filesRead, FilePathSchema.parse(path)),
    ),
  filesWrite: async (request) =>
    filesResultSchema(z.null()).parse(
      await ipcRenderer.invoke(IPC.filesWrite, FileWriteRequestSchema.parse(request)),
    ),
  filesCreate: async (request) =>
    filesResultSchema(z.null()).parse(
      await ipcRenderer.invoke(IPC.filesCreate, FileCreateRequestSchema.parse(request)),
    ),
  filesRename: async (request) =>
    filesResultSchema(z.null()).parse(
      await ipcRenderer.invoke(IPC.filesRename, FileRenameRequestSchema.parse(request)),
    ),
  filesRemove: async (path) =>
    filesResultSchema(z.null()).parse(
      await ipcRenderer.invoke(IPC.filesRemove, FilePathSchema.min(1).parse(path)),
    ),
  examFilesStatus: async () =>
    ExamFilesStatusSchema.parse(await ipcRenderer.invoke(IPC.examFilesStatus)),
  retryExamFiles: async () => {
    await ipcRenderer.invoke(IPC.examFilesRetry);
  },
  onExamFilesStatus: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      const parsed = ExamFilesStatusSchema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(IPC.examFilesChanged, handler);
    return () => ipcRenderer.removeListener(IPC.examFilesChanged, handler);
  },
  terminalStatus: async () =>
    TerminalStatusSchema.parse(await ipcRenderer.invoke(IPC.terminalStatus)),
  openTerminal: async (size) =>
    TerminalOpenResultSchema.parse(
      await ipcRenderer.invoke(IPC.openTerminal, TerminalSizeSchema.parse(size)),
    ),
  terminalInput: (data) => ipcRenderer.send(IPC.terminalInput, TerminalInputSchema.parse(data)),
  resizeTerminal: (size) => ipcRenderer.send(IPC.resizeTerminal, TerminalSizeSchema.parse(size)),
  closeTerminal: async () => {
    await ipcRenderer.invoke(IPC.closeTerminal);
  },
  onTerminalData: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      const parsed = TerminalDataSchema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(IPC.terminalData, handler);
    return () => ipcRenderer.removeListener(IPC.terminalData, handler);
  },
  onTerminalExit: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      const parsed = TerminalExitSchema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(IPC.terminalExit, handler);
    return () => ipcRenderer.removeListener(IPC.terminalExit, handler);
  },
};

contextBridge.exposeInMainWorld('examguard', api);

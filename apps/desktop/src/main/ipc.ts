import { BrowserWindow, app, ipcMain } from 'electron';
import {
  JoinAttemptSchema,
  ProbeRequestSchema,
  SetModeRequestSchema,
  allowedModesFor,
  type AppInfo,
  type AppMode,
  type InstallType,
  type SessionState,
} from '@examguard/shared';
import { IPC } from '../shared/ipc-channels.js';
import { readDeviceId } from './device-id.js';
import { Discovery } from './discovery.js';
import type { ExamLock } from './exam-lock.js';
import { JoinClient } from './join-client.js';
import { probeHost } from './probe-host.js';
import { SessionClient } from './session-client.js';
import { resolveMode, saveStoredMode } from './mode-store.js';
import { registerRunnerIpc } from './runner/runner-ipc.js';
import type { ServerHost } from './server-host.js';
import { registerTerminalIpc } from './terminal/terminal-ipc.js';

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

export function registerIpc(state: AppState, server: ServerHost, examLock: ExamLock): void {
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

  const joinClient = new JoinClient(() =>
    readDeviceId({ override: process.env.EG_DEVICE_ID, isPackaged: app.isPackaged }),
  );
  ipcMain.handle(IPC.joinExam, (_event, payload: unknown) => {
    requireStudent();
    return joinClient.join(JoinAttemptSchema.parse(payload));
  });
  ipcMain.handle(IPC.confirmJoin, () => {
    requireStudent();
    return joinClient.confirm();
  });

  let onTerminalExam: (exam: SessionState) => void = () => {};
  const session = new SessionClient({
    onStatus: (status) => {
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send(IPC.sessionStatus, status);
    },
    onExam: (exam) => {
      examLock.setActive(exam.examState === 'running');
      onTerminalExam(exam);
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.sessionExam, exam);
    },
  });
  registerRunnerIpc({
    session,
    examStudentId: () => joinClient.examStudentId(),
    requireStudent,
  });
  onTerminalExam = registerTerminalIpc({
    session,
    examStudentId: () => joinClient.examStudentId(),
    requireStudent,
  });

  ipcMain.handle(IPC.startSession, () => {
    requireStudent();
    const credentials = joinClient.credentials();
    if (!credentials) throw new Error('Join an exam first');
    session.start(credentials.target, credentials.token);
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

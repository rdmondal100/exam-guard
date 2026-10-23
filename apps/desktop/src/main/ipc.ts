import { BrowserWindow, app, ipcMain, safeStorage } from 'electron';
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
import { examWorking } from './exam-working.js';
import { JoinClient } from './join-client.js';
import { probeHost } from './probe-host.js';
import { SessionClient } from './session-client.js';
import { resolveMode, saveStoredMode } from './mode-store.js';
import { registerAgentIpc } from './agent/agent-ipc.js';
import { toAgentBlock } from './agent/agent-link.js';
import { createAgentLink } from './agent/create-agent-link.js';
import { runCommand } from './agent/run-command.js';
import { registerExamFilesIpc } from './exam-files/exam-files-ipc.js';
import { registerFilesIpc } from './files/files-ipc.js';
import { registerAnswersIpc } from './answers/answers-ipc.js';
import { registerResumeIpc, type ResumeHooks } from './resume/resume-ipc.js';
import { createSecretBox } from './resume/secret-box.js';
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
  const agentLink = createAgentLink(
    { isPackaged: app.isPackaged, env: process.env, appVersion: app.getVersion() },
    runCommand,
  );
  if (state.mode === 'student') agentLink.start();
  app.once('will-quit', () => agentLink.stop());
  registerAgentIpc({ userData: state.userData, link: agentLink, requireStudent });
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

  const joinClient = new JoinClient(
    () => readDeviceId({ override: process.env.EG_DEVICE_ID, isPackaged: app.isPackaged }),
    () => agentLink.check(),
  );
  ipcMain.handle(IPC.joinExam, (_event, payload: unknown) => {
    requireStudent();
    return joinClient.join(JoinAttemptSchema.parse(payload));
  });
  const resume: { hooks?: ResumeHooks } = {};
  ipcMain.handle(IPC.confirmJoin, async () => {
    requireStudent();
    const result = await joinClient.confirm();
    if (result.ok) resume.hooks?.afterConfirm();
    return result;
  });

  const onExamFiles = registerExamFilesIpc({
    examStudentId: () => joinClient.examStudentId(),
    credentials: () => joinClient.credentials(),
    requireStudent,
  });
  let onTerminalExam: (exam: SessionState) => void = () => {};
  const session = new SessionClient({
    onStatus: (status) => {
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send(IPC.sessionStatus, status);
      resume.hooks?.onStatus(status);
    },
    onAnswers: (status) => {
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send(IPC.answerStatus, status);
    },
    onExam: (exam) => {
      examLock.setActive(examWorking(exam));
      onTerminalExam(exam);
      onExamFiles(exam);
      resume.hooks?.onExam(exam);
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.sessionExam, exam);
    },
  });
  // The server learns how the agent link looks after each welcome and whenever it changes.
  session.setAgentStatus(toAgentBlock(agentLink.status()));
  agentLink.onChange((link) => session.setAgentStatus(toAgentBlock(link)));
  registerAnswersIpc({ session, requireStudent });
  resume.hooks = registerResumeIpc({
    userData: state.userData,
    box: createSecretBox(safeStorage),
    session,
    join: joinClient,
    requireStudent,
  });
  registerRunnerIpc({
    session,
    examStudentId: () => joinClient.examStudentId(),
    requireStudent,
  });
  registerFilesIpc({
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
    session.start(credentials.target, credentials.token, resume.hooks?.queue());
  });

  ipcMain.handle(IPC.setMode, async (_event, payload: unknown) => {
    const request = SetModeRequestSchema.parse(payload);
    if (!allowedModesFor(state.installType).includes(request.mode)) {
      throw new Error(`Mode "${request.mode}" is not allowed on this install`);
    }
    await saveStoredMode(state.userData, request.mode);
    state.mode = resolveMode(state.installType, request.mode);
    if (state.mode === 'teacher') server.start();
    if (state.mode === 'student') agentLink.start();
    return toInfo(state);
  });
}

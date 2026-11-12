import { BrowserWindow, app, ipcMain, safeStorage } from 'electron';
import {
  JoinAttemptSchema,
  ProbeRequestSchema,
  SetModeRequestSchema,
  allowedModesFor,
  type AppInfo,
  type AppMode,
  type InstallType,
  type MonitorStatus,
  type SessionState,
} from '@examguard/shared';
import { IPC } from '../shared/ipcChannels.js';
import { readDeviceId } from './join/deviceId.js';
import { Discovery } from './join/discovery.js';
import type { ExamLock } from './window/examLock.js';
import { examWorking } from './session/examWorking.js';
import { JoinClient } from './join/joinClient.js';
import { probeHost } from './join/probeHost.js';
import { SessionClient } from './session/sessionClient.js';
import { SessionExitWatch } from './session/sessionExitWatch.js';
import { resolveMode, saveStoredMode } from './mode/modeStore.js';
import { createMonitoring, OwnProcesses, wantsMonitoring } from './tracking/index.js';
import type { ExamMonitor } from './tracking/examMonitor.js';
import { registerExamFilesIpc } from './examFiles/examFilesIpc.js';
import { registerFilesIpc } from './files/filesIpc.js';
import { registerAnswersIpc } from './answers/answersIpc.js';
import { registerClipboardIpc } from './clipboard/clipboardIpc.js';
import type { ClipboardClear } from './clipboard/clipboardClear.js';
import { registerResumeIpc, type ResumeHooks } from './resume/resumeIpc.js';
import { createSecretBox } from './resume/secretBox.js';
import { registerRunnerIpc } from './runner/runnerIpc.js';
import type { ServerHost } from './server/serverHost.js';
import { registerTerminalIpc } from './terminal/terminalIpc.js';
import { captureScreenJpeg } from './screenshots/capture.js';
import { ThumbCapture } from './thumbs/thumbCapture.js';
import { LiveViews } from './live/liveViews.js';
import { openLiveWindow, primaryScreenSourceId } from './live/liveWindow.js';

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

export interface IpcHandle {
  /** The exam window: the parent of the hidden live view pages (M34). */
  announceWindow(window: BrowserWindow): void;
}

export function registerIpc(state: AppState, server: ServerHost, examLock: ExamLock): IpcHandle {
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

  // The monitor's self-check runs before each join (filled in once the session exists).
  const monitoring: { check?: () => Promise<MonitorStatus> } = {};
  const joinClient = new JoinClient(
    () => readDeviceId({ override: process.env.EG_DEVICE_ID, isPackaged: app.isPackaged }),
    () => (monitoring.check ? monitoring.check() : Promise.reject(new Error('Not ready'))),
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
  let monitor: ExamMonitor | null = null;
  let clipboardClear: ClipboardClear | null = null;
  let thumbs: ThumbCapture | null = null;
  let liveViews: LiveViews | null = null;
  // The exam window: the parent of the hidden live view pages (M34).
  let examWindow: BrowserWindow | null = null;
  // A failed session, or a link that stayed down past the deadline, must not trap the student.
  const exitWatch = new SessionExitWatch({ release: () => examLock.setActive(false) });
  app.once('will-quit', () => exitWatch.stop());
  const session = new SessionClient({
    onStatus: (status) => {
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send(IPC.sessionStatus, status);
      resume.hooks?.onStatus(status);
      exitWatch.setStatus(status);
    },
    onAnswers: (status) => {
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send(IPC.answerStatus, status);
    },
    onExam: (exam) => {
      examLock.setActive(examWorking(exam));
      exitWatch.setExam(exam);
      onTerminalExam(exam);
      onExamFiles(exam);
      monitor?.onExam(exam);
      thumbs?.setMonitoring(state.mode === 'student' && wantsMonitoring(exam));
      liveViews?.setMonitoring(state.mode === 'student' && wantsMonitoring(exam));
      clipboardClear?.onExam(exam);
      resume.hooks?.onExam(exam);
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.sessionExam, exam);
    },
    onStop: () => {
      monitor?.reset();
      clipboardClear?.reset();
      thumbs?.stop();
      thumbs?.setMonitoring(false);
      liveViews?.setMonitoring(false);
    },
    onThumbs: (command) => thumbs?.setCommand(command),
    onLive: (message) => {
      if (!liveViews) return;
      if (message === null) return liveViews.socketClosed();
      if (message.t === 'live.request') return void liveViews.request(message);
      if (message.t === 'live.stop') return liveViews.stop(message.sessionId);
      liveViews.signal(message.sessionId, message.data);
    },
    onTeacherMessage: (message) => {
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send(IPC.sessionMessage, message);
    },
  });
  // Grid thumbnails while the teacher has this student on the visible page (M33).
  thumbs = new ThumbCapture({
    capture: captureScreenJpeg,
    send: (jpeg, capturedAt) => session.sendThumb(jpeg, capturedAt),
  });
  // The teacher's WebRTC live view: one hidden capture page per session (M34).
  liveViews = new LiveViews({
    open: (onMessage, onGone) => openLiveWindow(examWindow, onMessage, onGone),
    sourceId: primaryScreenSourceId,
    send: (message) => session.sendLive(message),
  });
  // Window switches, sites, launches and screens while the exam runs go to the server as events
  // with screenshots (requirements §8.5). The app only watches; it never changes the PC.
  const own = new OwnProcesses();
  const created = createMonitoring({
    session: {
      examStudentId: () => joinClient.examStudentId(),
      sendEvidence: (evidence) => session.sendEvidence(evidence),
      setMonitorStatus: (status) => session.setMonitorStatus(status),
    },
    own,
  });
  monitor = created.monitor;
  monitoring.check = created.check;
  // After a restart mid-exam there is no join, so the server hears the check from here.
  if (state.mode === 'student') void created.check();
  registerAnswersIpc({ session, requireStudent });
  // The clipboard is emptied at the start; blocked outside pastes are logged (M25).
  clipboardClear = registerClipboardIpc({ session, requireStudent });
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
    own,
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
    own,
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
    if (state.mode === 'student') void created.check();
    return toInfo(state);
  });

  return {
    announceWindow: (window) => {
      examWindow = window;
      window.once('closed', () => {
        if (examWindow === window) examWindow = null;
      });
    },
  };
}

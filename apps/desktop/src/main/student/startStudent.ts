import { BrowserWindow, app, ipcMain, safeStorage } from 'electron';
import {
  JoinAttemptSchema,
  ProbeRequestSchema,
  type MonitorStatus,
  type SessionState,
} from '@examguard/shared';
import { IPC } from '../../shared/ipcChannels.js';
import type { AppStart, StartContext } from '../appStart.js';
import { readDeviceId } from '../join/deviceId.js';
import { Discovery } from '../join/discovery.js';
import { examWorking } from '../session/examWorking.js';
import { JoinClient } from '../join/joinClient.js';
import { probeHost } from '../join/probeHost.js';
import { SessionClient } from '../session/sessionClient.js';
import { SessionExitWatch } from '../session/sessionExitWatch.js';
import { createMonitoring, OwnProcesses, wantsMonitoring } from '../tracking/index.js';
import type { ExamMonitor } from '../tracking/examMonitor.js';
import { registerExamFilesIpc } from '../examFiles/examFilesIpc.js';
import { registerFilesIpc } from '../files/filesIpc.js';
import { registerAnswersIpc } from '../answers/answersIpc.js';
import { registerClipboardIpc } from '../clipboard/clipboardIpc.js';
import type { ClipboardClear } from '../clipboard/clipboardClear.js';
import { registerResumeIpc, type ResumeHooks } from '../resume/resumeIpc.js';
import { createSecretBox } from '../resume/secretBox.js';
import { registerRunnerIpc } from '../runner/runnerIpc.js';
import { registerTerminalIpc } from '../terminal/terminalIpc.js';
import { captureScreenJpeg } from '../screenshots/capture.js';
import { ThumbCapture } from '../thumbs/thumbCapture.js';
import { LiveViews } from '../live/liveViews.js';
import { openLiveWindow, primaryScreenSourceId } from '../live/liveWindow.js';
import { resolveToolchain } from '../runner/toolchains.js';
import { runRoot } from '../runner/runRoot.js';
import { LobbyReadiness } from './readiness/lobbyReadiness.js';
import { runSelfTest } from './readiness/selfTest.js';
import { registerShutdownIpc } from './shutdown/shutdownIpc.js';

/**
 * The student app (M52): discovery, join, the live session, the in-app monitor, answers,
 * clipboard, resume, the runner, the Files panel, the terminal, thumbnails and the live view.
 * Only this app contains any of it; there is no mode to check.
 */
export function startStudent({ userData, examLock }: StartContext): AppStart {
  const discovery = new Discovery((hosts) => {
    for (const win of BrowserWindow.getAllWindows())
      win.webContents.send(IPC.discoveryHosts, hosts);
  });
  // Every module below still takes this guard; in the student app it always passes.
  const requireStudent = () => undefined;

  ipcMain.handle(IPC.startDiscovery, () => {
    discovery.start();
    return discovery.list();
  });
  ipcMain.handle(IPC.stopDiscovery, () => discovery.stop());
  ipcMain.handle(IPC.probeHost, (_event, payload: unknown) =>
    probeHost(ProbeRequestSchema.parse(payload)),
  );

  // The monitor's self-check runs before each join (filled in once the session exists).
  const monitoring: { check?: () => Promise<MonitorStatus> } = {};
  const joinClient = new JoinClient(
    () => readDeviceId({ override: process.env.EG_DEVICE_ID, isPackaged: app.isPackaged }),
    () => (monitoring.check ? monitoring.check() : Promise.reject(new Error('Not ready'))),
  );
  ipcMain.handle(IPC.joinExam, (_event, payload: unknown) =>
    joinClient.join(JoinAttemptSchema.parse(payload)),
  );
  const resume: { hooks?: ResumeHooks } = {};
  ipcMain.handle(IPC.confirmJoin, async () => {
    const result = await joinClient.confirm();
    if (result.ok) resume.hooks?.afterConfirm();
    return result;
  });

  const onExamFiles = registerExamFilesIpc({
    examStudentId: () => joinClient.examStudentId(),
    credentials: () => joinClient.credentials(),
    requireStudent,
  });
  let onTerminalExam: (exam: SessionState | null) => void = () => {};
  let stopRun: () => void = () => {};
  let monitor: ExamMonitor | null = null;
  let clipboardClear: ClipboardClear | null = null;
  let thumbs: ThumbCapture | null = null;
  let liveViews: LiveViews | null = null;
  // The exam window: the parent of the hidden live view pages (M34).
  let examWindow: BrowserWindow | null = null;
  // The lobby readiness check (M54): compile and run in every language before the exam starts.
  let readiness: LobbyReadiness | null = null;
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
      // The exam is over for this student (submitted, ended): a program still running stops.
      if (!examWorking(exam)) stopRun();
      exitWatch.setExam(exam);
      onTerminalExam(exam);
      onExamFiles(exam);
      monitor?.onExam(exam);
      thumbs?.setMonitoring(wantsMonitoring(exam));
      liveViews?.setMonitoring(wantsMonitoring(exam));
      clipboardClear?.onExam(exam);
      readiness?.onExam(exam);
      resume.hooks?.onExam(exam);
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.sessionExam, exam);
    },
    onStop: () => {
      // Leave (M60): nothing of this exam keeps running into the next one.
      stopRun();
      onTerminalExam(null);
      readiness?.reset();
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
  readiness = new LobbyReadiness({
    run: () =>
      runSelfTest({
        tools: resolveToolchain({
          isPackaged: app.isPackaged,
          appPath: app.getAppPath(),
          resourcesPath: process.resourcesPath,
          execPath: process.execPath,
          env: process.env,
        }),
        workDir: runRoot(process.env.LOCALAPPDATA ?? app.getPath('temp'), 'self-test'),
        env: process.env,
      }),
    publish: (report) => {
      session.setReadiness(report);
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send(IPC.readinessReport, report);
    },
  });
  ipcMain.handle(IPC.readinessGet, () => readiness?.current() ?? null);
  // After submitting, the student may turn the PC off from the receipt screen (M57).
  registerShutdownIpc({
    exam: () => session.examState,
    pendingEvidence: () => session.pendingEvidence,
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
  void created.check();
  registerAnswersIpc({ session, requireStudent });
  // The clipboard is emptied at the start; blocked outside pastes are logged (M25).
  clipboardClear = registerClipboardIpc({ session, requireStudent });
  resume.hooks = registerResumeIpc({
    userData,
    box: createSecretBox(safeStorage),
    session,
    join: joinClient,
    requireStudent,
  });
  ({ stop: stopRun } = registerRunnerIpc({
    session,
    examStudentId: () => joinClient.examStudentId(),
    requireStudent,
    own,
  }));
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
    const credentials = joinClient.credentials();
    if (!credentials) throw new Error('Join an exam first');
    session.start(credentials.target, credentials.token, resume.hooks?.queue());
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

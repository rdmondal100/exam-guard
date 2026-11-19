import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  TerminalInputSchema,
  TerminalSizeSchema,
  type SessionState,
  type TerminalOpenResult,
  type TerminalStatus,
} from '@examguard/shared';
import { IPC } from '../../shared/ipcChannels.js';
import type { SessionClient } from '../session/sessionClient.js';
import { runRoot } from '../runner/runRoot.js';
import { resolveToolchain } from '../runner/toolchains.js';
import type { OwnProcesses } from '../tracking/ownProcesses.js';
import { parseInstalls } from './parseInstall.js';
import { spawnPty } from './pty.js';
import { terminalRefusal } from './terminalGate.js';
import { TerminalHost } from './terminalHost.js';
import { prepareTerminal } from './terminalLaunch.js';
import { TranscriptBuffer } from './transcriptBuffer.js';

/** Longest command line sent in a `terminal_command` event. */
const MAX_LOGGED_LINE = 2000;

export interface TerminalIpcDeps {
  session: SessionClient;
  examStudentId: () => string | null;
  requireStudent: () => void;
  /** The shell's windows and the monitor: the shell counts as the student's own program. */
  own: OwnProcesses;
}

const broadcast = (channel: string, payload: unknown) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
};

/**
 * `terminal:status|open|input|resize|close`, pushes `terminal:data|exit`. Every opening, closing
 * and command line goes to the server as an event, and the output as the transcript. Returns the
 * hook main calls on every exam state: the terminal closes as soon as the teacher's switch, its
 * time window or the exam state no longer allows it.
 */
export function registerTerminalIpc({
  session,
  examStudentId,
  requireStudent,
  own,
}: TerminalIpcDeps): (exam: SessionState | null) => void {
  const serverNow = () => session.serverNow();
  const refusal = () => terminalRefusal(session.examState, serverNow());
  const transcript = new TranscriptBuffer({
    send: (key, text) => session.sendTranscript(key, text),
  });
  const host = new TerminalHost({
    spawn: spawnPty,
    onData: (data) => {
      transcript.append(data);
      broadcast(IPC.terminalData, data);
    },
    onExit: (exit) => {
      transcript.flush();
      session.sendEvent('terminal_closed', { reason: exit.reason, exitCode: exit.exitCode });
      broadcast(IPC.terminalExit, exit);
    },
    onShell: (pid) => {
      own.set('terminal', pid);
      if (pid !== null) session.sendEvent('terminal_opened', {});
    },
    onCommand: (line) => {
      const logged = line.slice(0, MAX_LOGGED_LINE);
      session.sendEvent('terminal_command', {
        line: logged,
        ...(line.length > MAX_LOGGED_LINE ? { truncated: true } : {}),
      });
      for (const install of parseInstalls(line)) {
        session.sendEvent('package_installed', { ...install, line: logged });
      }
    },
  });
  app.on('will-quit', () => host.close());

  const launch = () =>
    prepareTerminal({
      runRoot: runRoot(process.env.LOCALAPPDATA ?? app.getPath('temp'), examStudentId()),
      // Resolved per open, like runs, so `pnpm fetch-toolchains` is picked up without a restart.
      tools: resolveToolchain({
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        execPath: process.execPath,
        env: process.env,
      }),
      baseEnv: process.env,
      shell: join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
    });

  ipcMain.handle(IPC.terminalStatus, (): TerminalStatus => {
    requireStudent();
    return { available: refusal() === null, open: host.isOpen };
  });
  ipcMain.handle(IPC.openTerminal, (_event, payload: unknown): TerminalOpenResult => {
    requireStudent();
    const size = TerminalSizeSchema.parse(payload);
    const refused = refusal();
    if (refused) return { ok: false, message: refused };
    try {
      host.open(launch, size);
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : 'The terminal could not start.',
      };
    }
  });
  // Keystrokes and resizes are fire-and-forget (`send`), so typing has no round trip.
  ipcMain.on(IPC.terminalInput, (_event, payload: unknown) => {
    const data = TerminalInputSchema.safeParse(payload);
    if (data.success) host.write(data.data);
  });
  ipcMain.on(IPC.resizeTerminal, (_event, payload: unknown) => {
    const size = TerminalSizeSchema.safeParse(payload);
    if (size.success) host.resize(size.data);
  });
  ipcMain.handle(IPC.closeTerminal, () => {
    requireStudent();
    host.close();
  });

  // Backs up the server's auto-off at `until`, should its push be late or the link down.
  let windowTimer: ReturnType<typeof setTimeout> | null = null;
  const enforce = () => {
    if (refusal()) host.close('turned_off');
  };
  // `null`: the session was left (M60), so the shell (and its working folder) closes now.
  return (exam) => {
    if (!exam) host.close('closed');
    enforce();
    if (windowTimer) clearTimeout(windowTimer);
    windowTimer = null;
    const until = exam?.terminal.enabled ? exam.terminal.until : null;
    if (until !== null) windowTimer = setTimeout(enforce, Math.max(0, until - serverNow()) + 50);
  };
}

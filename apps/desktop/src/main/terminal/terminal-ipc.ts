import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  TerminalInputSchema,
  TerminalSizeSchema,
  type SessionState,
  type TerminalOpenResult,
  type TerminalStatus,
} from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import type { SessionClient } from '../session-client.js';
import { runRoot } from '../runner/run-root.js';
import { resolveToolchain } from '../runner/toolchains.js';
import { spawnPty } from './pty.js';
import { terminalEnabled, terminalRefusal } from './terminal-gate.js';
import { TerminalHost } from './terminal-host.js';
import { prepareTerminal } from './terminal-launch.js';

export interface TerminalIpcDeps {
  session: SessionClient;
  examStudentId: () => string | null;
  requireStudent: () => void;
}

const broadcast = (channel: string, payload: unknown) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
};

/**
 * `terminal:status|open|input|resize|close`, pushes `terminal:data|exit`. Returns the hook that
 * main calls on every exam state: the terminal closes as soon as the exam stops running.
 */
export function registerTerminalIpc({
  session,
  examStudentId,
  requireStudent,
}: TerminalIpcDeps): (exam: SessionState) => void {
  const enabled = terminalEnabled(app.isPackaged, process.env);
  const host = new TerminalHost({
    spawn: spawnPty,
    onData: (data) => broadcast(IPC.terminalData, data),
    onExit: (exit) => broadcast(IPC.terminalExit, exit),
  });
  app.on('will-quit', () => host.close());

  const launch = () =>
    prepareTerminal({
      runRoot: runRoot(process.env.LOCALAPPDATA ?? app.getPath('temp'), examStudentId()),
      // Resolved per open, like runs, so a fetch or cargo build is picked up without a restart.
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
    return { available: terminalRefusal(session.examState, enabled) === null, open: host.isOpen };
  });
  ipcMain.handle(IPC.openTerminal, (_event, payload: unknown): TerminalOpenResult => {
    requireStudent();
    const size = TerminalSizeSchema.parse(payload);
    const refusal = terminalRefusal(session.examState, enabled);
    if (refusal) return { ok: false, message: refusal };
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

  return (exam) => {
    if (exam.examState !== 'running') host.close();
  };
}

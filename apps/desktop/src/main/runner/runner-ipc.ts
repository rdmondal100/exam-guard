import { app, BrowserWindow, ipcMain } from 'electron';
import { RunInputSchema, RunRequestSchema, RunSizeSchema, type RunResult } from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import type { SessionClient } from '../session-client.js';
import { spawnPtyProcess } from '../terminal/pty.js';
import { runRefusal } from './check-run.js';
import { CodeRunner } from './code-runner.js';
import { runRoot } from './run-root.js';
import { resolveToolchain } from './toolchains.js';

export interface RunnerIpcDeps {
  session: SessionClient;
  /** This student's exam row, which names the run folder. */
  examStudentId: () => string | null;
  requireStudent: () => void;
}

/** Longest flags text in a `run_executed` event (the request schema already caps it). */
const MAX_LOGGED_FLAGS = 500;

/**
 * `runner:run` / `runner:stop`, `runner:input|resize` for the program's console and the
 * `runner:data` push. Every finished run is reported as a `run_executed` event.
 */
export function registerRunnerIpc({ session, examStudentId, requireStudent }: RunnerIpcDeps): void {
  const runner = new CodeRunner({
    // Resolved per run, so `pnpm fetch-toolchains` or a cargo build is picked up without a restart.
    toolchain: () =>
      resolveToolchain({
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        execPath: process.execPath,
        env: process.env,
      }),
    workRoot: () => runRoot(process.env.LOCALAPPDATA ?? app.getPath('temp'), examStudentId()),
    baseEnv: process.env,
    openPty: spawnPtyProcess,
    onData: (data) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.runData, data);
    },
    onRun: (request, result) =>
      session.sendEvent('run_executed', {
        questionId: request.questionId,
        language: request.language,
        flags: request.flags.slice(0, MAX_LOGGED_FLAGS),
        status: result.status,
        exitCode: result.exitCode,
        timeMs: result.timeMs,
      }),
  });

  ipcMain.handle(IPC.runCode, async (_event, payload: unknown): Promise<RunResult> => {
    requireStudent();
    const request = RunRequestSchema.parse(payload);
    const refusal = runRefusal(session.examState, request);
    if (refusal) {
      return {
        status: 'failed',
        exitCode: null,
        timeMs: null,
        stdout: '',
        stderr: '',
        compileOutput: '',
        diagnostics: [],
        message: refusal,
      };
    }
    return runner.run(request);
  });
  ipcMain.handle(IPC.stopRun, () => {
    requireStudent();
    runner.stop();
  });
  // Keystrokes and resizes are fire-and-forget (`send`), so typing has no round trip.
  ipcMain.on(IPC.runInput, (_event, payload: unknown) => {
    const data = RunInputSchema.safeParse(payload);
    if (data.success) runner.write(data.data);
  });
  ipcMain.on(IPC.runResize, (_event, payload: unknown) => {
    const size = RunSizeSchema.safeParse(payload);
    if (size.success) runner.resize(size.data);
  });
}

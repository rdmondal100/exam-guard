import { app, ipcMain } from 'electron';
import { RunRequestSchema, type RunResult } from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import type { SessionClient } from '../session-client.js';
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

/** `runner:run` / `runner:stop`. Every finished run is reported as a `run_executed` event. */
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
    onRun: (request, result) =>
      session.sendEvent('run_executed', {
        questionId: request.questionId,
        language: request.language,
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
}

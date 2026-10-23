import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import type { SessionState } from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import { runRoot } from '../runner/run-root.js';
import { terminalPaths } from '../terminal/terminal-env.js';
import type { PinnedTarget } from '../tls-pin.js';
import { ExamFileSync } from './exam-file-sync.js';
import { DownloadError, downloadExamFile } from './pinned-download.js';

export interface ExamFilesIpcDeps {
  examStudentId: () => string | null;
  /** The pinned host and session token, once the student has joined. */
  credentials: () => { target: PinnedTarget; token: string } | null;
  requireStudent: () => void;
}

/**
 * `examfiles:status|retry` and the `examfiles:changed` push. Returns the hook main calls on every
 * exam state: the teacher's files download while the student waits in the lobby and are copied
 * into the project folder once the exam runs (`ExamFileSync`).
 */
export function registerExamFilesIpc({
  examStudentId,
  credentials,
  requireStudent,
}: ExamFilesIpcDeps): (exam: SessionState) => void {
  const paths = () =>
    terminalPaths(runRoot(process.env.LOCALAPPDATA ?? app.getPath('temp'), examStudentId()));
  const sync = new ExamFileSync({
    stageDir: () => join(paths().support, 'exam-files'),
    workspaceDir: () => paths().workspace,
    download: (file, destPath) => {
      const session = credentials();
      if (!session) throw new DownloadError('refused', 'Join the exam first', false);
      return downloadExamFile({ ...session, file, destPath });
    },
    onStatus: (status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.examFilesChanged, status);
      }
    },
  });

  ipcMain.handle(IPC.examFilesStatus, () => {
    requireStudent();
    return sync.status;
  });
  ipcMain.handle(IPC.examFilesRetry, () => {
    requireStudent();
    sync.retry();
  });

  return (exam) => {
    if (exam.examState === 'hosting' || exam.examState === 'running') {
      sync.update(exam.examFiles, exam.examState === 'running');
    }
  };
}

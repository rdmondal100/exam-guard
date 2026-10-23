import { app, ipcMain } from 'electron';
import {
  FileCreateRequestSchema,
  FilePathSchema,
  FileRenameRequestSchema,
  FileWriteRequestSchema,
  FilesListRequestSchema,
  type FilesResult,
} from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import { runRoot } from '../runner/run-root.js';
import type { SessionClient } from '../session-client.js';
import { terminalPaths } from '../terminal/terminal-env.js';
import { FilesError } from './files-error.js';
import { filesRefusal } from './files-gate.js';
import { WorkspaceFiles } from './workspace-fs.js';

export interface FilesIpcDeps {
  session: SessionClient;
  examStudentId: () => string | null;
  requireStudent: () => void;
}

/** What went wrong, for the student: our own refusals as they are, a disk error in one line. */
function refusalOf(error: unknown): string | null {
  if (error instanceof FilesError) return error.message;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'EBUSY' || code === 'EPERM') return 'That file is in use by another program.';
  if (code === 'ENOSPC') return 'The disk is full.';
  return code ? 'The file operation failed.' : null;
}

/**
 * `files:list|read|write|create|rename|remove` on the exam workspace (the folder Run and the
 * terminal share). Each call returns a `FilesResult`: a refusal is an answer, not an exception.
 */
export function registerFilesIpc({ session, examStudentId, requireStudent }: FilesIpcDeps): void {
  const files = new WorkspaceFiles(
    () =>
      terminalPaths(runRoot(process.env.LOCALAPPDATA ?? app.getPath('temp'), examStudentId()))
        .workspace,
  );

  const handle = <T>(channel: string, work: (payload: unknown) => Promise<T>) =>
    ipcMain.handle(channel, async (_event, payload: unknown): Promise<FilesResult<T>> => {
      requireStudent();
      const refusal = filesRefusal(session.examState);
      if (refusal) return { ok: false, message: refusal };
      try {
        return { ok: true, value: await work(payload) };
      } catch (error) {
        const message = refusalOf(error);
        if (message === null) throw error;
        return { ok: false, message };
      }
    });

  handle(IPC.filesList, (p) => {
    const request = FilesListRequestSchema.parse(p);
    return files.list(request.path, request.showHidden);
  });
  handle(IPC.filesRead, (p) => files.read(FilePathSchema.parse(p)));
  handle(IPC.filesWrite, async (p) => {
    const request = FileWriteRequestSchema.parse(p);
    await files.write(request.path, request.content);
    return null;
  });
  handle(IPC.filesCreate, async (p) => {
    const request = FileCreateRequestSchema.parse(p);
    await files.create(request.path, request.kind);
    return null;
  });
  handle(IPC.filesRename, async (p) => {
    const request = FileRenameRequestSchema.parse(p);
    await files.rename(request.from, request.to);
    return null;
  });
  handle(IPC.filesRemove, async (p) => {
    await files.remove(FilePathSchema.min(1).parse(p));
    return null;
  });
}

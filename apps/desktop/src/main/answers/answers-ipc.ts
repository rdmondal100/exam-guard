import { ipcMain } from 'electron';
import { AnswerSaveRequestSchema } from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import type { SessionClient } from '../session-client.js';

export interface AnswersIpcDeps {
  session: SessionClient;
  requireStudent: () => void;
}

/**
 * `answers:save`: the renderer's autosave. Main numbers the save and keeps it until acked.
 * `exam:submit`: asks the server to make the answers final; it settles once the server answers
 * (possibly after a reconnect), and the receipt reaches the renderer on `session:exam`.
 */
export function registerAnswersIpc({ session, requireStudent }: AnswersIpcDeps): void {
  ipcMain.handle(IPC.answerSave, (_event, payload: unknown) => {
    requireStudent();
    session.sendAnswer(AnswerSaveRequestSchema.parse(payload));
  });
  ipcMain.handle(IPC.submitExam, () => {
    requireStudent();
    return session.submit();
  });
}

import { ipcMain } from 'electron';
import { AnswerSaveRequestSchema } from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import type { SessionClient } from '../session-client.js';

export interface AnswersIpcDeps {
  session: SessionClient;
  requireStudent: () => void;
}

/** `answers:save`: the renderer's autosave. Main numbers the save and keeps it until acked. */
export function registerAnswersIpc({ session, requireStudent }: AnswersIpcDeps): void {
  ipcMain.handle(IPC.answerSave, (_event, payload: unknown) => {
    requireStudent();
    session.sendAnswer(AnswerSaveRequestSchema.parse(payload));
  });
}

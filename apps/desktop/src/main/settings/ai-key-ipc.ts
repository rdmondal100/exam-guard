import { ipcMain } from 'electron';
import { AiKeySetRequestSchema, type AiKeyStatus } from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import type { AiKeyStore } from './ai-key-store.js';

interface AiKeyIpcDeps {
  store: AiKeyStore;
  isTeacher: () => boolean;
}

/**
 * Teacher mode (M43): save, clear and ask about the AI key. The key itself only ever goes
 * renderer → main; the answers carry the status, never the key.
 */
export function registerAiKeyIpc({ store, isTeacher }: AiKeyIpcDeps): void {
  const guard = () => {
    if (!isTeacher()) throw new Error('The AI key is for Teacher mode');
  };
  ipcMain.handle(IPC.aiKeyStatus, (): AiKeyStatus => {
    guard();
    return store.status();
  });
  ipcMain.handle(IPC.aiKeySet, (_event, payload: unknown): AiKeyStatus => {
    guard();
    const { apiKey } = AiKeySetRequestSchema.parse(payload);
    if (!store.save(apiKey)) {
      throw new Error('Windows could not encrypt the key on this PC, so it was not saved.');
    }
    return store.status();
  });
  ipcMain.handle(IPC.aiKeyClear, (): AiKeyStatus => {
    guard();
    store.clear();
    return store.status();
  });
}

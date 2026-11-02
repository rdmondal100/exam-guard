import { app, clipboard, ipcMain } from 'electron';
import { PasteBlockedReportSchema } from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import type { SessionClient } from '../session-client.js';
import { ClipboardClear } from './clipboard-clear.js';
import { PasteReporter } from './paste-reporter.js';

export interface ClipboardIpcDeps {
  session: Pick<SessionClient, 'sendEvent'>;
  requireStudent: () => void;
}

/**
 * Clipboard control (M25): `clipboard:paste-blocked` from the renderer's paste guard becomes a
 * `paste_blocked` event (throttled), and the returned `ClipboardClear` empties the clipboard when
 * the exam starts for this student. Feed it every exam state.
 */
export function registerClipboardIpc({
  session,
  requireStudent,
}: ClipboardIpcDeps): ClipboardClear {
  const reporter = new PasteReporter((details) => session.sendEvent('paste_blocked', details));
  app.once('will-quit', () => reporter.dispose());
  ipcMain.handle(IPC.pasteBlocked, (_event, payload: unknown) => {
    requireStudent();
    reporter.report(PasteBlockedReportSchema.parse(payload));
  });
  return new ClipboardClear(() => clipboard.clear());
}

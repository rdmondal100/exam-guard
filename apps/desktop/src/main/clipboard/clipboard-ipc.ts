import { app, clipboard, ipcMain } from 'electron';
import {
  LargeInsertionReportSchema,
  PasteBlockedReportSchema,
  type LargeInsertionReport,
  type PasteBlockedReport,
} from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import type { SessionClient } from '../session-client.js';
import { ClipboardClear } from './clipboard-clear.js';
import { ThrottledReporter } from './throttled-reporter.js';

export interface ClipboardIpcDeps {
  session: Pick<SessionClient, 'sendEvent'>;
  requireStudent: () => void;
}

/**
 * Clipboard and typing control: `clipboard:paste-blocked` from the renderer's paste guard becomes a
 * `paste_blocked` event (M25) and `insertion:large` a `large_insertion` event (M27), each
 * throttled; the returned `ClipboardClear` empties the clipboard when the exam starts for this
 * student. Feed it every exam state.
 */
export function registerClipboardIpc({
  session,
  requireStudent,
}: ClipboardIpcDeps): ClipboardClear {
  const pastes = new ThrottledReporter<PasteBlockedReport>((details) =>
    session.sendEvent('paste_blocked', details),
  );
  const insertions = new ThrottledReporter<LargeInsertionReport>((details) =>
    session.sendEvent('large_insertion', details),
  );
  app.once('will-quit', () => {
    pastes.dispose();
    insertions.dispose();
  });
  ipcMain.handle(IPC.pasteBlocked, (_event, payload: unknown) => {
    requireStudent();
    pastes.report(PasteBlockedReportSchema.parse(payload));
  });
  ipcMain.handle(IPC.largeInsertion, (_event, payload: unknown) => {
    requireStudent();
    insertions.report(LargeInsertionReportSchema.parse(payload));
  });
  return new ClipboardClear(() => clipboard.clear());
}

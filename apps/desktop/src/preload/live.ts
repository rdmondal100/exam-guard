// Preload of the hidden live view capture page (M34): the page only gets its start command and
// the teacher's signals, and can only send signals and its end back. Nothing else of main.
//
// It imports nothing but electron: a sandboxed preload can only require electron, and anything it
// shared with the app's preload would be split into a chunk file neither could load. Main
// validates every message with `LivePageMessageSchema`, and what main sends was validated on its
// way in (`ServerToStudentSchema`). The channel names equal `IPC.live*` (checked by a test).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ExamGuardLiveApi } from './live-api.js';

const CHANNELS = { start: 'live:start', signal: 'live:signal', page: 'live:page' } as const;

const api: ExamGuardLiveApi = {
  onStart: (listener) => {
    ipcRenderer.on(CHANNELS.start, (_event: IpcRendererEvent, payload: unknown) => {
      listener(payload as Parameters<typeof listener>[0]);
    });
  },
  onSignal: (listener) => {
    ipcRenderer.on(CHANNELS.signal, (_event: IpcRendererEvent, payload: unknown) => {
      listener(payload as Parameters<typeof listener>[0]);
    });
  },
  send: (message) => ipcRenderer.send(CHANNELS.page, message),
};

contextBridge.exposeInMainWorld('examguardLive', api);

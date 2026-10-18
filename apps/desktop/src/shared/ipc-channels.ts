/** IPC channel names shared by main and preload. */
export const IPC = {
  getInfo: 'app:get-info',
  setMode: 'app:set-mode',
  getServerConnection: 'server:get-connection',
  getServerStatus: 'server:get-status',
  serverStatus: 'server:status',
} as const;

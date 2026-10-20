/** IPC channel names shared by main and preload. */
export const IPC = {
  getInfo: 'app:get-info',
  setMode: 'app:set-mode',
  getServerConnection: 'server:get-connection',
  getServerStatus: 'server:get-status',
  serverStatus: 'server:status',
  startDiscovery: 'discovery:start',
  stopDiscovery: 'discovery:stop',
  discoveryHosts: 'discovery:hosts',
  probeHost: 'discovery:probe',
  joinExam: 'join:attempt',
  confirmJoin: 'join:confirm',
} as const;

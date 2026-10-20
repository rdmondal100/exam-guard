import type {
  AppInfo,
  AppMode,
  DiscoveredHost,
  JoinAttempt,
  JoinConfirmResult,
  JoinResult,
  ProbeRequest,
  ProbeResult,
  ServerConnection,
  ServerStatus,
} from '@examguard/shared';

/** The only surface the renderer gets: `window.examguard`. */
export interface ExamGuardApi {
  getInfo(): Promise<AppInfo>;
  setMode(mode: AppMode): Promise<AppInfo>;
  /** Teacher mode only. `null` while the server has not started. */
  getServerConnection(): Promise<ServerConnection | null>;
  getServerStatus(): Promise<ServerStatus>;
  /** Returns an unsubscribe function. */
  onServerStatus(listener: (status: ServerStatus) => void): () => void;
  /** Student mode: start browsing for teachers over mDNS. Returns the hosts known so far. */
  startDiscovery(): Promise<DiscoveredHost[]>;
  stopDiscovery(): Promise<void>;
  /** Returns an unsubscribe function. */
  onDiscoveryHosts(listener: (hosts: DiscoveredHost[]) => void): () => void;
  /** Contacts a host (mDNS or manual IP), pins its cert and reads its info. */
  probeHost(request: ProbeRequest): Promise<ProbeResult>;
  /** Student mode: join the pinned host. The session token stays in main. */
  joinExam(attempt: JoinAttempt): Promise<JoinResult>;
  /** Student mode: the monitoring notice was accepted. */
  confirmJoin(): Promise<JoinConfirmResult>;
}

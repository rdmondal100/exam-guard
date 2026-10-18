import type { AppInfo, AppMode, ServerConnection, ServerStatus } from '@examguard/shared';

/** The only surface the renderer gets: `window.examguard`. */
export interface ExamGuardApi {
  getInfo(): Promise<AppInfo>;
  setMode(mode: AppMode): Promise<AppInfo>;
  /** Teacher mode only. `null` while the server has not started. */
  getServerConnection(): Promise<ServerConnection | null>;
  getServerStatus(): Promise<ServerStatus>;
  /** Returns an unsubscribe function. */
  onServerStatus(listener: (status: ServerStatus) => void): () => void;
}

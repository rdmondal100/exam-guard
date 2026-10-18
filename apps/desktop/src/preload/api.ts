import type { AppInfo, AppMode } from '@examguard/shared';

/** The only surface the renderer gets: `window.examguard`. */
export interface ExamGuardApi {
  getInfo(): Promise<AppInfo>;
  setMode(mode: AppMode): Promise<AppInfo>;
}

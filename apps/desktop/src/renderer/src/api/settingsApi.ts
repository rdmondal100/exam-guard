import {
  AuthOkSchema,
  BackupResultSchema,
  CertInfoSchema,
  RetentionPurgeResultSchema,
  TeacherSettingsSchema,
  type BackupResult,
  type CertInfo,
  type RetentionPurgeResult,
  type ServerConnection,
  type SettingsPatch,
  type TeacherSettings,
} from '@examguard/shared';
import { call, type FetchFn } from './teacherApi';

/** The Settings screen (M43). The AI key goes through preload instead (`window.examguard`). */
export interface SettingsApi {
  get(): Promise<TeacherSettings>;
  /** Rejects `invalid_body` with `details.problems`. */
  update(patch: SettingsPatch): Promise<TeacherSettings>;
  /** Rejects `bad_password`, `rate_limited` or `invalid_body` (new password too short). */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  backup(): Promise<BackupResult>;
  cert(): Promise<CertInfo>;
  /** Rejects `hosting_active` while an exam is hosted or running. */
  regenerateCert(): Promise<CertInfo>;
  /** Applies screenshot retention now (M44). */
  purgeScreenshots(): Promise<RetentionPurgeResult>;
}

export function createSettingsApi(
  connection: ServerConnection,
  fetchFn: FetchFn = fetch,
): SettingsApi {
  return {
    get: () => call(connection, fetchFn, '/settings', TeacherSettingsSchema),
    update: (patch) =>
      call(connection, fetchFn, '/settings', TeacherSettingsSchema, patch, 'PATCH'),
    changePassword: async (currentPassword, newPassword) => {
      await call(connection, fetchFn, '/auth/change', AuthOkSchema, {
        currentPassword,
        newPassword,
      });
    },
    backup: () => call(connection, fetchFn, '/settings/backup', BackupResultSchema, {}),
    cert: () => call(connection, fetchFn, '/settings/cert', CertInfoSchema),
    regenerateCert: () =>
      call(connection, fetchFn, '/settings/regenerate-cert', CertInfoSchema, {}),
    purgeScreenshots: () =>
      call(connection, fetchFn, '/settings/retention/purge', RetentionPurgeResultSchema, {}),
  };
}

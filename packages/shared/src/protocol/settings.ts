import { z } from 'zod';
import { RUN_LIMITS } from '../app/runner.js';
import {
  DEFAULT_MONITORING,
  MAX_EXAM_DURATION_MIN,
  MIN_EXAM_DURATION_MIN,
  MonitoringSettingsSchema,
} from './exams.js';
import { STUDENT_API_PORT } from './hosting.js';

/**
 * The run limits the teacher sets (M43): wall time, memory, output and processes. Snapshotted
 * into the exam when hosting starts, so a change reaches students at the next exam.
 */
export const RunLimitsSchema = z.object({
  timeMs: z
    .number()
    .int()
    .min(5_000)
    .max(60 * 60_000),
  memoryMb: z.number().int().min(32).max(4_096),
  outputBytes: z
    .number()
    .int()
    .min(4 * 1024)
    .max(4 * 1024 * 1024),
  processes: z.number().int().min(1).max(64),
});
export type RunLimits = z.infer<typeof RunLimitsSchema>;

export const DEFAULT_RUN_LIMITS: RunLimits = {
  timeMs: RUN_LIMITS.timeMs,
  memoryMb: RUN_LIMITS.memoryMb,
  outputBytes: RUN_LIMITS.outputBytes,
  processes: RUN_LIMITS.processes,
};

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GRADING_CONCURRENCY = 4;
export const DEFAULT_EXAM_DURATION_MIN = 90;

/** Model names as Gemini spells them (`gemini-2.5-flash`, `models/gemini-2.5-pro`). */
const ModelSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._/-]+$/, 'Letters, digits, dots, dashes and slashes only');

/**
 * The teacher's settings (`settings` table, one row per section; docs/data-model.md). The AI key
 * is not here: main keeps it encrypted with `safeStorage` (`secrets.bin`).
 */
export const TeacherSettingsSchema = z.object({
  ai: z.object({ provider: z.literal('gemini'), model: ModelSchema }),
  grading: z.object({ concurrency: z.number().int().min(1).max(16) }),
  defaults: z.object({
    durationMin: z.number().int().min(MIN_EXAM_DURATION_MIN).max(MAX_EXAM_DURATION_MIN),
    monitoring: MonitoringSettingsSchema,
  }),
  runLimits: RunLimitsSchema,
  /** The student listener's port (TCP); used at the next hosting start. */
  server: z.object({ studentPort: z.number().int().min(1024).max(65_535) }),
});
export type TeacherSettings = z.infer<typeof TeacherSettingsSchema>;

export const DEFAULT_SETTINGS: TeacherSettings = {
  ai: { provider: 'gemini', model: DEFAULT_GEMINI_MODEL },
  grading: { concurrency: DEFAULT_GRADING_CONCURRENCY },
  defaults: { durationMin: DEFAULT_EXAM_DURATION_MIN, monitoring: DEFAULT_MONITORING },
  runLimits: DEFAULT_RUN_LIMITS,
  server: { studentPort: STUDENT_API_PORT },
};

/** `PATCH /settings`: any sections, each one whole. */
export const SettingsPatchSchema = TeacherSettingsSchema.partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

/** `POST /settings/backup` (M43): the folder name in `backups/`. */
export const BackupResultSchema = z.object({ backup: z.string() });
export type BackupResult = z.infer<typeof BackupResultSchema>;

/** `GET /settings/cert` and `POST /settings/regenerate-cert` (M43). */
export const CertInfoSchema = z.object({ fingerprint: z.string(), fpCode: z.string() });
export type CertInfo = z.infer<typeof CertInfoSchema>;

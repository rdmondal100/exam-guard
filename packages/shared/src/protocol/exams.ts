import { z } from 'zod';

export const MAX_EXAM_TITLE_LENGTH = 200;
export const MIN_EXAM_DURATION_MIN = 1;
export const MAX_EXAM_DURATION_MIN = 600;

export const ExamStateSchema = z.enum([
  'draft',
  'ready',
  'hosting',
  'running',
  'ended',
  'grading',
  'in_review',
  'finalized',
]);
export type ExamState = z.infer<typeof ExamStateSchema>;

/** Per-exam monitoring settings (`exams.monitoring_json`). Times are seconds. */
export const MonitoringSettingsSchema = z.object({
  screenshotOnSwitch: z.boolean(),
  screenshotOnTitleChange: z.boolean(),
  screenshotIntervalSec: z.number().int().min(5).max(300),
  minScreenshotGapSec: z.number().int().min(1).max(60),
  highSeverityApps: z.array(z.string().trim().min(1).max(100)).max(100),
  graceSec: z.number().int().min(0).max(600),
});
export type MonitoringSettings = z.infer<typeof MonitoringSettingsSchema>;

export const ExamSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  state: ExamStateSchema,
  durationMin: z.number().int().positive(),
  classListId: z.string().nullable(),
  classListName: z.string().nullable(),
  monitoring: MonitoringSettingsSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ExamSummary = z.infer<typeof ExamSummarySchema>;

const TitleSchema = z.string().trim().min(1).max(MAX_EXAM_TITLE_LENGTH);
const DurationSchema = z.number().int().min(MIN_EXAM_DURATION_MIN).max(MAX_EXAM_DURATION_MIN);

/** `POST /exams`. Monitoring defaults are filled in by the server when absent. */
export const ExamCreateBodySchema = z.object({
  title: TitleSchema,
  durationMin: DurationSchema,
  classListId: z.string().nullable().optional(),
  monitoring: MonitoringSettingsSchema.optional(),
});
export type ExamCreateBody = z.infer<typeof ExamCreateBodySchema>;

/** `PATCH /exams/:id`. Every field is optional. */
export const ExamUpdateBodySchema = z.object({
  title: TitleSchema.optional(),
  durationMin: DurationSchema.optional(),
  classListId: z.string().nullable().optional(),
  monitoring: MonitoringSettingsSchema.optional(),
});
export type ExamUpdateBody = z.infer<typeof ExamUpdateBodySchema>;

export const ExamsSchema = z.array(ExamSummarySchema);

/** Screenshot policy from requirements §8.5 and the 60 s grace period from §8.4. */
export const DEFAULT_MONITORING: MonitoringSettings = {
  screenshotOnSwitch: true,
  screenshotOnTitleChange: true,
  screenshotIntervalSec: 20,
  minScreenshotGapSec: 5,
  highSeverityApps: [],
  graceSec: 60,
};

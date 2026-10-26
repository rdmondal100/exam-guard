import { z } from 'zod';
import { type MonitorPolicy } from './agent-pipe.js';
import { type MonitoringSettings } from './exams.js';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

/** One event as the teacher sees it (`GET /exams/:id/events`). */
export const EventRowSchema = z.object({
  id: z.number().int(),
  examStudentId: z.string().nullable(),
  studentCode: z.string().nullable(),
  studentName: z.string().nullable(),
  type: z.string(),
  severity: SeveritySchema,
  serverTs: z.number(),
  clientTs: z.number().nullable(),
  details: z.record(z.string(), z.unknown()),
  hasScreenshot: z.boolean(),
});
export type EventRow = z.infer<typeof EventRowSchema>;

export const EventsResponseSchema = z.object({ events: z.array(EventRowSchema) });
export type EventsResponse = z.infer<typeof EventsResponseSchema>;

export const MAX_EVENTS_PER_PAGE = 500;

/** Screenshot size the helper produces (docs/architecture.md §3). */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_JPEG_QUALITY = 60;

/** The helper's rules for an exam's monitoring settings. */
export function monitorPolicyFor(settings: MonitoringSettings): MonitorPolicy {
  return {
    screenshotOnSwitch: settings.screenshotOnSwitch,
    titleChangeShots: settings.screenshotOnTitleChange,
    periodicOutsideSec: settings.screenshotIntervalSec,
    minShotGapSec: settings.minScreenshotGapSec,
    maxWidth: SCREENSHOT_MAX_WIDTH,
    jpegQuality: SCREENSHOT_JPEG_QUALITY,
  };
}

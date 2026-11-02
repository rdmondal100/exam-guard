import { z } from 'zod';
import { type MonitorPolicy } from './agent-pipe.js';
import { type MonitoringSettings } from './exams.js';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

/**
 * Events from the app and the server that belong in the teacher's monitoring list next to the
 * agent's evidence (`GET /exams/:id/events?view=monitoring`, M25) and that are pushed live as
 * `alert` (M31). The rest (runs, terminal, internet switch) are kept out of it.
 */
export const MONITORING_EVENT_TYPES = [
  'agent_lost',
  'paste_blocked',
  'large_insertion',
  'network_lost',
  'network_restored',
  'duplicate_login',
] as const;

export type EventSource = 'agent' | 'app' | 'server';

/** Whether an event is part of the monitoring view and the live alert feed. */
export function isMonitoringEvent(source: EventSource, type: string): boolean {
  return source === 'agent' || (MONITORING_EVENT_TYPES as readonly string[]).includes(type);
}

/** Severity order, for "this severity and above" filters. */
export const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function severityAtLeast(severity: Severity, min: Severity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[min];
}

/** The teacher's event list views. `monitoring` = agent evidence plus `MONITORING_EVENT_TYPES`. */
export const EventViewSchema = z.enum(['monitoring']);
export type EventView = z.infer<typeof EventViewSchema>;

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

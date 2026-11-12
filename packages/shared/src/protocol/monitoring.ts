import { z } from 'zod';

/**
 * Screenshot and outside-time rules the student app's monitor follows while the exam runs
 * (docs/architecture.md §3).
 */
export const MonitorPolicySchema = z.object({
  screenshotOnSwitch: z.boolean(),
  titleChangeShots: z.boolean(),
  /** A shot this often while the student stays outside; 0 turns it off. */
  periodicOutsideSec: z.number().int().min(0).max(300),
  minShotGapSec: z.number().int().min(1).max(60),
  maxWidth: z.number().int().min(320).max(3840),
  jpegQuality: z.number().int().min(10).max(95),
});
export type MonitorPolicy = z.infer<typeof MonitorPolicySchema>;

/**
 * What the student app's monitor reports (requirements §8.5). `still_outside` is the periodic shot
 * while away; `app_launched` is a program that opened its first window, `processes_at_start` the
 * programs with a window when monitoring began; `monitor_changed` a second screen at the start or a
 * change of the count; `secure_desktop` the lock screen or Ctrl+Alt+Del; `taskmgr_opened` Task
 * Manager in front.
 */
export const EVIDENCE_KINDS = [
  'focus_lost',
  'focus_returned',
  'title_changed',
  'still_outside',
  'app_launched',
  'processes_at_start',
  'monitor_changed',
  'secure_desktop',
  'taskmgr_opened',
] as const;
export const EvidenceKindSchema = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export function isEvidenceKind(type: string): type is EvidenceKind {
  return (EVIDENCE_KINDS as readonly string[]).includes(type);
}

/** Most programs `processes_at_start` lists. */
export const MAX_START_PROCESSES = 300;

/**
 * The details a monitor event carries. A browser in front adds the site: `domain` (what severity
 * and the teacher's high-severity list match), `url` (the address as evidence), or `privateWindow`
 * for Incognito / InPrivate, whose address is never read.
 */
export const EvidenceDetailsSchema = z.object({
  exe: z.string().max(260).optional(),
  path: z.string().max(520).optional(),
  pid: z.number().int().nonnegative().optional(),
  title: z.string().max(500).optional(),
  domain: z.string().max(253).optional(),
  url: z.string().max(2048).optional(),
  privateWindow: z.boolean().optional(),
  /** `focus_returned`: how long the student was outside. */
  durationMs: z.number().int().nonnegative().optional(),
  /** `processes_at_start`: the programs with a window when monitoring began. */
  processes: z
    .array(z.object({ exe: z.string().max(260), pid: z.number().int().nonnegative() }))
    .max(MAX_START_PROCESSES)
    .optional(),
  /** `monitor_changed`: screens now, and before the change (absent: more than one at the start). */
  monitors: z.number().int().min(0).max(32).optional(),
  monitorsBefore: z.number().int().min(0).max(32).optional(),
  /** `secure_desktop`: what took the screen (`lock`). */
  desktop: z.string().max(64).optional(),
});
export type EvidenceDetails = z.infer<typeof EvidenceDetailsSchema>;

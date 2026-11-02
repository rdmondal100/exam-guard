import { z } from 'zod';

/** Longest "on for N minutes" window the teacher can set. */
export const MAX_TERMINAL_MINUTES = 600;

/**
 * Whether the exam terminal may be open. `until` is server time (ms); `null` = no end (or, before
 * Start, an "N minutes" window that has not begun counting yet).
 */
export const TerminalStateSchema = z.object({
  enabled: z.boolean(),
  until: z.number().nullable(),
});
export type TerminalState = z.infer<typeof TerminalStateSchema>;

export const TerminalActionSchema = z.object({
  type: z.literal('terminal'),
  enabled: z.boolean(),
  /** Only with `enabled: true`. Counted from Start, or from now if the exam is running. */
  minutes: z.number().int().min(1).max(MAX_TERMINAL_MINUTES).optional(),
});
export type TerminalAction = z.infer<typeof TerminalActionSchema>;

/** Whether students' PCs may reach the internet (server-authoritative). The teacher PC stays reachable. */
export const InternetStateSchema = z.enum(['allowed', 'blocked']);
export type InternetState = z.infer<typeof InternetStateSchema>;

export const InternetActionSchema = z.object({
  type: z.literal('internet'),
  /** `true` lets students reach the internet, `false` blocks it. */
  enabled: z.boolean(),
});
export type InternetAction = z.infer<typeof InternetActionSchema>;

/**
 * Lets a locked student (M24: the agent link was lost) continue. The full per-student lock and
 * unlock arrive with the teacher actions (M35).
 */
export const UnlockActionSchema = z.object({
  type: z.literal('unlock'),
  examStudentId: z.string().min(1).max(100),
});
export type UnlockAction = z.infer<typeof UnlockActionSchema>;

/** `POST /exams/:id/actions`. */
export const ExamActionSchema = z.discriminatedUnion('type', [
  TerminalActionSchema,
  InternetActionSchema,
  UnlockActionSchema,
]);
export type ExamAction = z.infer<typeof ExamActionSchema>;

/** Reply to an `unlock` action. */
export const UnlockActionResultSchema = z.object({
  ok: z.literal(true),
  studentState: z.literal('active'),
});
export type UnlockActionResult = z.infer<typeof UnlockActionResultSchema>;

/** Reply to a `terminal` action: the state students now get. */
export const TerminalActionResultSchema = z.object({
  ok: z.literal(true),
  terminal: TerminalStateSchema,
  /** The "N minutes" window that starts counting at Start, if any. */
  pendingMinutes: z.number().int().nullable(),
});
export type TerminalActionResult = z.infer<typeof TerminalActionResultSchema>;

/** Reply to an `internet` action. */
export const InternetActionResultSchema = z.object({
  ok: z.literal(true),
  internet: InternetStateSchema,
});
export type InternetActionResult = z.infer<typeof InternetActionResultSchema>;

export const TerminalLogEventSchema = z.object({
  id: z.number().int(),
  type: z.string(),
  serverTs: z.number(),
  clientTs: z.number().nullable(),
  details: z.record(z.string(), z.unknown()),
});
export type TerminalLogEvent = z.infer<typeof TerminalLogEventSchema>;

/** `GET /exams/:id/students/:sid/terminal`: terminal events and the stored transcript. */
export const TerminalLogResponseSchema = z.object({
  events: z.array(TerminalLogEventSchema),
  /** Terminal output as the student saw it (ANSI codes kept). */
  transcript: z.string(),
  truncated: z.boolean(),
});
export type TerminalLogResponse = z.infer<typeof TerminalLogResponseSchema>;

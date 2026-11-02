import { z } from 'zod';
import { StudentStateSchema } from './join.js';

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

/** `POST /exams/:id/actions`: the exam-wide switches. */
export const ExamActionSchema = z.discriminatedUnion('type', [
  TerminalActionSchema,
  InternetActionSchema,
]);
export type ExamAction = z.infer<typeof ExamActionSchema>;

/** Why a student is locked: their agent link was lost (M24) or the teacher locked them (M35). */
export const LockReasonSchema = z.enum(['agent', 'teacher']);
export type LockReason = z.infer<typeof LockReasonSchema>;

/** Longest teacher message or warning, in characters. */
export const MAX_TEACHER_MESSAGE = 500;
/** Most minutes one extension adds. */
export const MAX_EXTENSION_MINUTES = 600;

/**
 * `POST /exams/:id/students/:sid/actions` (M35). `message` is a popup (`kind: 'warning'` is logged
 * as `warn`); `end` makes the student's answers final (`ended_by_teacher`); `reset_session` signs
 * the student out so they can join again from another PC.
 */
export const StudentActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message'),
    kind: z.enum(['info', 'warning']),
    text: z.string().trim().min(1).max(MAX_TEACHER_MESSAGE),
  }),
  z.object({ type: z.literal('lock') }),
  z.object({ type: z.literal('unlock') }),
  z.object({
    type: z.literal('extend'),
    minutes: z.number().int().min(1).max(MAX_EXTENSION_MINUTES),
  }),
  z.object({ type: z.literal('end') }),
  z.object({ type: z.literal('reset_session') }),
]);
export type StudentAction = z.infer<typeof StudentActionSchema>;

/** Reply to a student action: the student afterwards. */
export const StudentActionResultSchema = z.object({
  ok: z.literal(true),
  studentState: StudentStateSchema,
  /** The student's deadline (server time), or `null` before the start. */
  deadline: z.number().nullable(),
  /** The student's app was connected and got it at once (otherwise it waits for their next connection). */
  delivered: z.boolean(),
});
export type StudentActionResult = z.infer<typeof StudentActionResultSchema>;

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

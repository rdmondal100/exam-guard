import { z } from 'zod';
import { ProtocolVersionSchema } from './protocol-version.js';
import { StudentStateSchema } from './join.js';
import { ExamStateSchema } from './exams.js';
import { StudentQuestionSchema } from './questions.js';

/** Idle limit on a student socket and the client's ping period (docs/protocol.md §3). */
export const STUDENT_IDLE_MS = 15_000;
export const STUDENT_PING_MS = 5_000;
export const HELLO_TIMEOUT_MS = 5_000;
/** Largest student WS frame (docs/architecture.md §2). */
export const MAX_WS_FRAME_BYTES = 512 * 1024;

/** WS close codes the server uses on the student socket. */
export const WS_CLOSE = {
  badHello: 4400,
  unauthorized: 4401,
  protocolMismatch: 4426,
  replaced: 4409,
  notHosting: 4503,
} as const;

// ---- student → server ----

export const HelloSchema = z.object({
  t: z.literal('hello'),
  token: z.string().min(16).max(256),
  protocol: ProtocolVersionSchema,
  resume: z.object({ lastServerSeq: z.number().int().nonnegative() }),
});
export type Hello = z.infer<typeof HelloSchema>;

export const PingSchema = z.object({ t: z.literal('ping'), clientSent: z.number() });
export type Ping = z.infer<typeof PingSchema>;

/** Event types the student app reports itself. Agent evidence types join with monitoring. */
export const APP_EVENT_TYPES = ['run_executed'] as const;
export const AppEventTypeSchema = z.enum(APP_EVENT_TYPES);
export type AppEventType = z.infer<typeof AppEventTypeSchema>;

export const EventReportSchema = z.object({
  t: z.literal('event'),
  id: z.string().min(1).max(100),
  /** Unique per event; the server stores a key once, so a resend is harmless. */
  dedupeKey: z.string().min(1).max(200),
  clientTs: z.number(),
  type: AppEventTypeSchema,
  details: z.record(z.string(), z.unknown()),
});
export type EventReport = z.infer<typeof EventReportSchema>;

export const StudentMessageSchema = z.discriminatedUnion('t', [
  HelloSchema,
  PingSchema,
  EventReportSchema,
]);
export type StudentMessage = z.infer<typeof StudentMessageSchema>;

// ---- server → student ----

export const SessionStateSchema = z.object({
  examState: ExamStateSchema,
  studentState: StudentStateSchema,
  deadline: z.number().nullable(),
  /** Sent once the exam is running. */
  questions: z.array(StudentQuestionSchema).optional(),
  saved: z.array(
    z.object({
      questionId: z.string(),
      language: z.string(),
      clientSeq: z.number().int(),
      selected: z.boolean(),
    }),
  ),
  locked: z.boolean(),
  monitoring: z.boolean(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export const WelcomeSchema = z.object({
  t: z.literal('welcome'),
  serverTime: z.number(),
  state: SessionStateSchema,
});
export type Welcome = z.infer<typeof WelcomeSchema>;

/** Pushed on start, extend, lock, end. Carries only the fields that changed. */
export const StateUpdateSchema = z.object({
  t: z.literal('state'),
  state: SessionStateSchema.partial(),
});
export type StateUpdate = z.infer<typeof StateUpdateSchema>;

export const PongSchema = z.object({
  t: z.literal('pong'),
  clientSent: z.number(),
  serverTime: z.number(),
});
export type Pong = z.infer<typeof PongSchema>;

export const WsErrorSchema = z.object({
  t: z.literal('error'),
  code: z.string(),
  message: z.string(),
});
export type WsError = z.infer<typeof WsErrorSchema>;

/** The event is stored (or was already). */
export const EventAckSchema = z.object({ t: z.literal('event.ack'), id: z.string() });
export type EventAck = z.infer<typeof EventAckSchema>;

export const ServerToStudentSchema = z.discriminatedUnion('t', [
  WelcomeSchema,
  StateUpdateSchema,
  PongSchema,
  EventAckSchema,
  WsErrorSchema,
]);
export type ServerToStudent = z.infer<typeof ServerToStudentSchema>;

// ---- teacher UI ⇄ server ----

export const SubscribeSchema = z.object({ t: z.literal('subscribe'), examId: z.string().min(1) });
export type Subscribe = z.infer<typeof SubscribeSchema>;

export const TeacherMessageSchema = z.discriminatedUnion('t', [SubscribeSchema]);
export type TeacherMessage = z.infer<typeof TeacherMessageSchema>;

export const RosterEntrySchema = z.object({
  id: z.string(),
  studentCode: z.string(),
  name: z.string(),
  state: StudentStateSchema,
  connected: z.boolean(),
  riskScore: z.number().int(),
  outsideMs: z.number().int(),
  lastSeen: z.number().nullable(),
  agentOk: z.boolean(),
});
export type RosterEntry = z.infer<typeof RosterEntrySchema>;

/** Full on subscribe, then only the students that changed. */
export const RosterUpdateSchema = z.object({
  t: z.literal('roster'),
  students: z.array(RosterEntrySchema),
});
export type RosterUpdate = z.infer<typeof RosterUpdateSchema>;

export const HostingCountsSchema = z.object({
  joined: z.number().int().nonnegative(),
  inLobby: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  submitted: z.number().int().nonnegative(),
  connected: z.number().int().nonnegative(),
});
export type HostingCounts = z.infer<typeof HostingCountsSchema>;

export const HostingStatusSchema = HostingCountsSchema.extend({ t: z.literal('hosting') });
export type HostingStatus = z.infer<typeof HostingStatusSchema>;

export const ServerNoticeSchema = z.object({
  t: z.literal('notice'),
  level: z.enum(['info', 'warn', 'error']),
  text: z.string(),
});
export type ServerNotice = z.infer<typeof ServerNoticeSchema>;

export const ServerToTeacherSchema = z.discriminatedUnion('t', [
  RosterUpdateSchema,
  HostingStatusSchema,
  ServerNoticeSchema,
]);
export type ServerToTeacher = z.infer<typeof ServerToTeacherSchema>;

/** `GET /exams/:id/roster`. */
export const RosterResponseSchema = z.object({
  students: z.array(RosterEntrySchema),
  counts: HostingCountsSchema,
});
export type RosterResponse = z.infer<typeof RosterResponseSchema>;

// ---- student main → renderer ----

export const SESSION_LINK_STATES = ['connecting', 'connected', 'reconnecting', 'failed'] as const;
export const SessionStatusSchema = z.object({
  link: z.enum(SESSION_LINK_STATES),
  /** Estimated server clock minus local clock, ms. `null` before the first pong. */
  offsetMs: z.number().nullable(),
  /** Set when the server said why it closed (for example `replaced`). */
  reason: z.string().optional(),
});
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

import { z } from 'zod';
import { ProtocolVersionSchema } from './protocol-version.js';
import { AgentStatusSchema, StudentStateSchema } from './join.js';
import {
  EVIDENCE_KINDS,
  EvidenceKindSchema,
  MonitorPolicySchema,
  type EvidenceKind,
} from './agent-pipe.js';
import { ExamStateSchema } from './exams.js';
import { EventRowSchema } from './events.js';
import { GradingStatusSchema } from './grading.js';
import { StudentQuestionSchema } from './questions.js';
import {
  InternetStateSchema,
  LockReasonSchema,
  MAX_TEACHER_MESSAGE,
  TerminalStateSchema,
} from './actions.js';
import { ExamFilesSchema } from './exam-files.js';
import { AnswerAckSchema, AnswerSaveSchema, SavedAnswerSchema } from './answers.js';
import {
  ReceiptSchema,
  SubmitRefusedSchema,
  SubmitResultSchema,
  SubmitSchema,
} from './submission.js';
import {
  ThumbStartSchema,
  ThumbStopSchema,
  ThumbsFocusSchema,
  ThumbsSubscribeSchema,
} from './thumbs.js';

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

/** Event types the student app reports itself. */
export const APP_EVENT_TYPES = [
  'run_executed',
  'terminal_opened',
  'terminal_closed',
  'terminal_command',
  'package_installed',
  'internet_blocked',
  'internet_allowed',
  'internet_block_failed',
  /** Text from outside the exam was pasted and blocked (M25). */
  'paste_blocked',
  /** The agent link stayed down while the exam ran; the server locks the student (M24). */
  'agent_lost',
  /** A burst of text far faster than typing, not an allowed paste (M27). */
  'large_insertion',
] as const;
export const AppEventTypeSchema = z.enum(APP_EVENT_TYPES);
export type AppEventType = z.infer<typeof AppEventTypeSchema>;

/** Event types that come from the agent's evidence and are relayed by the app (M22). */
export const AGENT_EVENT_TYPES = EVIDENCE_KINDS;
export const AgentEventTypeSchema = EvidenceKindSchema;
export type AgentEventType = EvidenceKind;

export const ReportedEventTypeSchema = z.union([AppEventTypeSchema, AgentEventTypeSchema]);
export type ReportedEventType = z.infer<typeof ReportedEventTypeSchema>;

export function isAgentEventType(type: string): type is AgentEventType {
  return (AGENT_EVENT_TYPES as readonly string[]).includes(type);
}

export const EventReportSchema = z.object({
  t: z.literal('event'),
  id: z.string().min(1).max(100),
  /** Unique per event; the server stores a key once, so a resend is harmless. */
  dedupeKey: z.string().min(1).max(200),
  clientTs: z.number(),
  type: ReportedEventTypeSchema,
  details: z.record(z.string(), z.unknown()),
  /** Names the binary screenshot chunks (kind 2) sent before this event; agent events only. */
  screenshotRef: z.string().min(1).max(100).optional(),
});
export type EventReport = z.infer<typeof EventReportSchema>;

/** Largest transcript chunk the client sends (characters). */
export const MAX_TRANSCRIPT_CHUNK = 16 * 1024;

/** A piece of the exam terminal's output. Stored once per `key`, so a resend is harmless. */
export const TranscriptChunkSchema = z.object({
  t: z.literal('transcript'),
  key: z.string().min(1).max(200),
  clientTs: z.number(),
  text: z.string().max(MAX_TRANSCRIPT_CHUNK),
});
export type TranscriptChunk = z.infer<typeof TranscriptChunkSchema>;

/** The student app's view of its agent link, sent after each welcome and whenever it changes (M21). */
export const AgentStatusMessageSchema = AgentStatusSchema.extend({ t: z.literal('agent.status') });
export type AgentStatusMessage = z.infer<typeof AgentStatusMessageSchema>;

/**
 * Whether this PC's internet is blocked right now, as the agent confirmed it (M21b). `error` says why a
 * block the teacher asked for is not in place. Sent after each welcome and on every change.
 */
export const InternetStatusMessageSchema = z.object({
  t: z.literal('internet.status'),
  blocked: z.boolean(),
  error: z.string().max(300).nullable(),
});
export type InternetStatusMessage = z.infer<typeof InternetStatusMessageSchema>;

/** The student app showed a server command (a teacher message, M35); the server stops re-sending it. */
export const AckSchema = z.object({ t: z.literal('ack'), id: z.string().min(1).max(100) });
export type Ack = z.infer<typeof AckSchema>;

export const StudentMessageSchema = z.discriminatedUnion('t', [
  AckSchema,
  HelloSchema,
  PingSchema,
  EventReportSchema,
  TranscriptChunkSchema,
  AnswerSaveSchema,
  SubmitSchema,
  AgentStatusMessageSchema,
  InternetStatusMessageSchema,
]);
export type StudentMessage = z.infer<typeof StudentMessageSchema>;

// ---- server → student ----

export const SessionStateSchema = z.object({
  examState: ExamStateSchema,
  studentState: StudentStateSchema,
  deadline: z.number().nullable(),
  /** Seconds after the deadline in which saves still count; the client uses it to know when the server has finalized it. */
  graceSec: z.number().int().min(0).max(600).optional(),
  /** Sent once the exam is running. */
  questions: z.array(StudentQuestionSchema).optional(),
  /** The newest stored version of each buffer; the client continues its `clientSeq` after these. */
  saved: z.array(SavedAnswerSchema),
  locked: z.boolean(),
  /** Why the student is locked; absent or `null` when not locked (M35). */
  lockReason: LockReasonSchema.nullable().optional(),
  monitoring: z.boolean(),
  /** What the agent does while the exam runs; set together with `monitoring: true` (M22). */
  monitoringPolicy: MonitorPolicySchema.optional(),
  /** The teacher's exam terminal switch (server-authoritative). */
  terminal: TerminalStateSchema,
  /** The teacher's internet switch (server-authoritative; M21b). */
  internet: InternetStateSchema,
  /** The teacher's Files panel switch for this exam (server-authoritative). */
  filesEnabled: z.boolean(),
  /** The files the teacher attached; students download them in the lobby (M15f). */
  examFiles: ExamFilesSchema,
  /** Set once the student's answers are final (submitted, auto-submitted or ended by the teacher). */
  receipt: ReceiptSchema.nullable().optional(),
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

/**
 * A teacher message or warning (M35), shown as a popup. Re-sent after every `welcome` until the
 * student app answers `ack`; the app shows each id once.
 */
export const TeacherMessageToStudentSchema = z.object({
  t: z.literal('message'),
  id: z.string().min(1).max(100),
  kind: z.enum(['info', 'warning']),
  text: z.string().min(1).max(MAX_TEACHER_MESSAGE),
  /** Server time the teacher sent it. */
  sentAt: z.number(),
});
export type TeacherMessageToStudent = z.infer<typeof TeacherMessageToStudentSchema>;

/** The transcript chunk is stored (or was already, or was dropped over the cap). */
export const TranscriptAckSchema = z.object({ t: z.literal('transcript.ack'), key: z.string() });
export type TranscriptAck = z.infer<typeof TranscriptAckSchema>;

export const ServerToStudentSchema = z.discriminatedUnion('t', [
  WelcomeSchema,
  StateUpdateSchema,
  PongSchema,
  EventAckSchema,
  TranscriptAckSchema,
  AnswerAckSchema,
  SubmitResultSchema,
  SubmitRefusedSchema,
  WsErrorSchema,
  ThumbStartSchema,
  ThumbStopSchema,
  TeacherMessageToStudentSchema,
]);
export type ServerToStudent = z.infer<typeof ServerToStudentSchema>;

// ---- teacher UI ⇄ server ----

export const SubscribeSchema = z.object({ t: z.literal('subscribe'), examId: z.string().min(1) });
export type Subscribe = z.infer<typeof SubscribeSchema>;

export const TeacherMessageSchema = z.discriminatedUnion('t', [
  SubscribeSchema,
  ThumbsSubscribeSchema,
  ThumbsFocusSchema,
]);
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
  /** The student's PC confirmed that its internet is blocked (M21b). */
  internetBlocked: z.boolean(),
  /** Screens the student's PC shows the desktop on, from the agent's last report (M26). */
  monitors: z.number().int().nonnegative(),
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

/**
 * A monitoring event was just stored for the subscribed exam (M31): the live alert feed. Only
 * events of the monitoring view (`isMonitoringEvent`) are pushed; the new risk score follows as
 * `roster`.
 */
export const AlertSchema = z.object({ t: z.literal('alert'), event: EventRowSchema });
export type Alert = z.infer<typeof AlertSchema>;

/** Grading moved on (M38): the whole status, at most a few times a second per exam. */
export const GradingProgressSchema = z.object({
  t: z.literal('grading.progress'),
  status: GradingStatusSchema,
});
export type GradingProgress = z.infer<typeof GradingProgressSchema>;

export const ServerToTeacherSchema = z.discriminatedUnion('t', [
  RosterUpdateSchema,
  HostingStatusSchema,
  ServerNoticeSchema,
  AlertSchema,
  GradingProgressSchema,
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

import { z } from 'zod';

/** Named pipe of the monitoring agent service (docs/protocol.md §4). */
export const AGENT_PIPE_NAME = String.raw`\\.\pipe\examguard-agent`;
export const PIPE_VERSION = 1;
/** Largest frame either side accepts. An `evidence` frame carries its screenshot as base64. */
export const MAX_PIPE_FRAME_BYTES = 4 * 1024 * 1024;
/** The service sends a heartbeat this often; 3 missing acks (6 s) mean the link is lost. */
export const HEARTBEAT_MS = 2_000;
export const HEARTBEAT_LOST_MS = 6_000;

const seq = z.number().int().nonnegative();

// ---- app → agent ----

export const PipeAppHelloSchema = z.object({
  t: z.literal('hello'),
  seq,
  pipeVersion: z.literal(PIPE_VERSION),
  appVersion: z.string().max(64),
});
export type PipeAppHello = z.infer<typeof PipeAppHelloSchema>;

export const PipeSystemCheckSchema = z.object({ t: z.literal('system.check'), seq });
export type PipeSystemCheck = z.infer<typeof PipeSystemCheckSchema>;

export const PipeHeartbeatAckSchema = z.object({
  t: z.literal('heartbeat.ack'),
  seq,
  hbSeq: seq,
});
export type PipeHeartbeatAck = z.infer<typeof PipeHeartbeatAckSchema>;

/**
 * Block (or stop blocking) the PC's internet except `allow`: IPv4 addresses, the teacher PC. The app
 * repeats a `blocked: true` request with every heartbeat; that is the lease, and the agent removes
 * the block when it stops coming (docs/architecture.md §3).
 */
export const PipeNetSetSchema = z.object({
  t: z.literal('net.set'),
  seq,
  blocked: z.boolean(),
  allow: z.array(z.string().max(45)).max(8),
});
export type PipeNetSet = z.infer<typeof PipeNetSetSchema>;

/** Screenshot and outside-time rules the helper follows while monitoring (docs/architecture.md §3). */
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

export const PipeMonitorStartSchema = z.object({
  t: z.literal('monitor.start'),
  seq,
  /** Whose evidence this is; the agent drops what it still holds of another student. */
  examStudentId: z.string().min(1).max(100),
  policy: MonitorPolicySchema,
});
export type PipeMonitorStart = z.infer<typeof PipeMonitorStartSchema>;

export const PipeMonitorStopSchema = z.object({ t: z.literal('monitor.stop'), seq });
export type PipeMonitorStop = z.infer<typeof PipeMonitorStopSchema>;

/** The exam window: the helper counts a foreground window of this process (or its children) as inside. */
export const PipeExamWindowSchema = z.object({
  t: z.literal('exam.window'),
  seq,
  hwnd: z.number().int().nonnegative(),
  pid: z.number().int().positive(),
});
export type PipeExamWindow = z.infer<typeof PipeExamWindowSchema>;

/** The server stored the evidence up to `upTo` (inclusive), so the agent may drop it. */
export const PipeEvidenceAckSchema = z.object({
  t: z.literal('evidence.ack'),
  seq,
  upTo: seq,
});
export type PipeEvidenceAck = z.infer<typeof PipeEvidenceAckSchema>;

export const AppToAgentSchema = z.discriminatedUnion('t', [
  PipeAppHelloSchema,
  PipeSystemCheckSchema,
  PipeHeartbeatAckSchema,
  PipeNetSetSchema,
  PipeMonitorStartSchema,
  PipeMonitorStopSchema,
  PipeExamWindowSchema,
  PipeEvidenceAckSchema,
]);
export type AppToAgent = z.infer<typeof AppToAgentSchema>;

// ---- agent → app ----

export const PipeAgentHelloSchema = z.object({
  t: z.literal('hello'),
  seq,
  pipeVersion: z.literal(PIPE_VERSION),
  agentVersion: z.string().max(64),
  /** The service's process id. The app compares it with the id the SCM reports (docs/architecture.md §3). */
  pid: z.number().int().positive(),
  helper: z.boolean(),
});
export type PipeAgentHello = z.infer<typeof PipeAgentHelloSchema>;

export const PipeSystemCheckResultSchema = z.object({
  t: z.literal('system.check.result'),
  seq,
  /** `seq` of the `system.check` this answers. */
  reqSeq: seq,
  ok: z.boolean(),
  helper: z.boolean(),
  captureOk: z.boolean(),
  monitors: z.number().int().nonnegative(),
  problems: z.array(z.string().max(200)).max(10),
});
export type PipeSystemCheckResult = z.infer<typeof PipeSystemCheckResultSchema>;

export const PipeHeartbeatSchema = z.object({
  t: z.literal('heartbeat'),
  seq,
  hbSeq: seq,
  helper: z.boolean(),
  monitoring: z.boolean(),
});
export type PipeHeartbeat = z.infer<typeof PipeHeartbeatSchema>;

/** Answer to `net.set`: whether the block is in place now. `error` is set when it could not be. */
export const PipeNetStatusSchema = z.object({
  t: z.literal('net.status'),
  seq,
  reqSeq: seq,
  blocked: z.boolean(),
  error: z.string().max(300).nullable(),
});
export type PipeNetStatus = z.infer<typeof PipeNetStatusSchema>;

/** Evidence kinds the helper reports so far (M22). `still_outside` is the periodic shot while away. */
export const EVIDENCE_KINDS = [
  'focus_lost',
  'focus_returned',
  'title_changed',
  'still_outside',
] as const;
export const EvidenceKindSchema = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

/** Largest screenshot the app accepts from the agent, as base64 text. */
export const MAX_SCREENSHOT_BASE64 = 3 * 1024 * 1024;

/** One observation of the helper. Kept by the agent until the app acks it (`evidence.ack`). */
export const PipeEvidenceSchema = z.object({
  t: z.literal('evidence'),
  seq,
  /** Counts up per agent run; with the device id it is the event's dedupe key. */
  evidenceSeq: seq,
  /** Unix ms on the student PC. */
  ts: z.number().int().nonnegative(),
  kind: EvidenceKindSchema,
  data: z.object({
    exe: z.string().max(260).optional(),
    path: z.string().max(520).optional(),
    pid: z.number().int().nonnegative().optional(),
    title: z.string().max(500).optional(),
    /** `focus_returned`: how long the student was outside. */
    durationMs: z.number().int().nonnegative().optional(),
  }),
  screenshot: z
    .object({
      jpegBase64: z.string().max(MAX_SCREENSHOT_BASE64),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
});
export type PipeEvidence = z.infer<typeof PipeEvidenceSchema>;

export const PipeErrorSchema = z.object({
  t: z.literal('error'),
  seq,
  code: z.string().max(64),
  message: z.string().max(300),
});
export type PipeError = z.infer<typeof PipeErrorSchema>;

export const AgentToAppSchema = z.discriminatedUnion('t', [
  PipeAgentHelloSchema,
  PipeSystemCheckResultSchema,
  PipeHeartbeatSchema,
  PipeNetStatusSchema,
  PipeEvidenceSchema,
  PipeErrorSchema,
]);
export type AgentToApp = z.infer<typeof AgentToAppSchema>;

import { z } from 'zod';

/** Named pipe of the monitoring agent service (docs/protocol.md §4). */
export const AGENT_PIPE_NAME = String.raw`\\.\pipe\examguard-agent`;
export const PIPE_VERSION = 1;
/** Largest frame either side accepts. Screenshots (M22) travel in their own, larger messages later. */
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

export const AppToAgentSchema = z.discriminatedUnion('t', [
  PipeAppHelloSchema,
  PipeSystemCheckSchema,
  PipeHeartbeatAckSchema,
  PipeNetSetSchema,
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
  PipeErrorSchema,
]);
export type AgentToApp = z.infer<typeof AgentToAppSchema>;

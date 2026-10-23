import { z } from 'zod';
import { ProtocolVersionSchema } from './protocol-version.js';

/** What the student's agent reports through its system check (M21). */
export const AgentStatusSchema = z.object({
  ok: z.boolean(),
  helper: z.boolean(),
  captureOk: z.boolean(),
  monitors: z.number().int().nonnegative(),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * Why an agent block is not good enough to join an exam, or null when it is. One rule for the
 * student app (which refuses locally) and the server (which refuses the request).
 */
export function agentProblem(agent: AgentStatus): string | null {
  if (!agent.helper) return 'The monitoring helper is not running.';
  if (!agent.captureOk) return 'The monitoring agent cannot capture the screen.';
  if (agent.monitors < 1) return 'The monitoring agent sees no screen.';
  if (!agent.ok) return 'The monitoring agent is not healthy.';
  return null;
}

/** Student API `POST /join`. */
export const JoinRequestSchema = z.object({
  studentCode: z.string().trim().min(1).max(64),
  pin: z.string().regex(/^\d{6}$/),
  deviceId: z.string().min(8).max(128),
  protocol: ProtocolVersionSchema,
  agent: AgentStatusSchema,
});
export type JoinRequest = z.infer<typeof JoinRequestSchema>;

export const STUDENT_STATES = [
  'not_joined',
  'lobby',
  'active',
  'locked',
  'submitted',
  'ended_by_teacher',
] as const;
export const StudentStateSchema = z.enum(STUDENT_STATES);
export type StudentState = z.infer<typeof StudentStateSchema>;

export const JoinResponseSchema = z.object({
  token: z.string().min(16),
  examStudentId: z.string(),
  name: z.string(),
  examTitle: z.string(),
  state: StudentStateSchema,
});
export type JoinResponse = z.infer<typeof JoinResponseSchema>;

/** Student API `POST /join/confirm`. */
export const JoinConfirmRequestSchema = z.object({ noticeAccepted: z.literal(true) });
export type JoinConfirmRequest = z.infer<typeof JoinConfirmRequestSchema>;

export const JOIN_ERROR_CODES = [
  'bad_pin',
  'not_on_list',
  'already_active_elsewhere',
  'not_hosting',
  'agent_required',
  'protocol_mismatch',
  'rate_limited',
] as const;
export type JoinErrorCode = (typeof JOIN_ERROR_CODES)[number];

/** Renderer → main: join the host the student picked. The token stays in main. */
export const JoinAttemptSchema = z.object({
  address: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  /** The cert fingerprint pinned during the probe. */
  fingerprint: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  studentCode: z.string().trim().min(1).max(64),
  pin: z.string().regex(/^\d{6}$/),
});
export type JoinAttempt = z.infer<typeof JoinAttemptSchema>;

export const JOIN_CLIENT_ERROR_CODES = [
  ...JOIN_ERROR_CODES,
  'unreachable',
  'fingerprint_mismatch',
  'bad_response',
  'no_session',
] as const;

/** Main → renderer. No token. */
export const JoinResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    examStudentId: z.string(),
    name: z.string(),
    examTitle: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(JOIN_CLIENT_ERROR_CODES),
    message: z.string(),
    retryAfterSec: z.number().int().positive().optional(),
  }),
]);
export type JoinResult = z.infer<typeof JoinResultSchema>;

export const JoinConfirmResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    code: z.enum(JOIN_CLIENT_ERROR_CODES),
    message: z.string(),
  }),
]);
export type JoinConfirmResult = z.infer<typeof JoinConfirmResultSchema>;

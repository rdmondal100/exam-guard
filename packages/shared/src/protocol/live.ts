import { z } from 'zod';

/**
 * WebRTC live view (M30, M34; docs/architecture.md §5): the teacher opens a live view, the server
 * asks the student app for it, and the student's screen goes peer to peer to the teacher's
 * renderer. Offer, answer and ICE candidates travel as `rtc.signal` through the server, which only
 * relays them between the two ends of a session it knows. Host candidates only (no STUN/TURN).
 */

/** Widest frame and frame rate of a live view. */
export const LIVE_MAX_WIDTH = 1280;
export const LIVE_FPS = 8;
/** Live views one teacher socket may have open at once. */
export const MAX_LIVE_PER_TEACHER = 2;
/** The teacher falls back to the fast thumbnail when no video arrives within this time. */
export const LIVE_CONNECT_TIMEOUT_MS = 10_000;
/** Largest SDP and ICE candidate the server relays. */
export const MAX_SDP_LENGTH = 64 * 1024;
export const MAX_CANDIDATE_LENGTH = 1024;

const SessionIdSchema = z.string().min(1).max(100);

export const RtcDescriptionSchema = z.object({
  type: z.enum(['offer', 'answer']),
  sdp: z.string().min(1).max(MAX_SDP_LENGTH),
});
export type RtcDescription = z.infer<typeof RtcDescriptionSchema>;

export const RtcCandidateSchema = z.object({
  candidate: z.string().max(MAX_CANDIDATE_LENGTH),
  sdpMid: z.string().max(64).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});
export type RtcCandidate = z.infer<typeof RtcCandidateSchema>;

export const RtcSignalDataSchema = z.union([RtcDescriptionSchema, RtcCandidateSchema]);
export type RtcSignalData = z.infer<typeof RtcSignalDataSchema>;

/** The same shape in every direction: student ⇄ server ⇄ teacher. */
export const RtcSignalSchema = z.object({
  t: z.literal('rtc.signal'),
  sessionId: SessionIdSchema,
  data: RtcSignalDataSchema,
});
export type RtcSignal = z.infer<typeof RtcSignalSchema>;

// ---- server → student ----

export const LiveRequestSchema = z.object({
  t: z.literal('live.request'),
  sessionId: SessionIdSchema,
  maxWidth: z.number().int().min(160).max(3840),
  fps: z.number().int().min(1).max(30),
});
export type LiveRequest = z.infer<typeof LiveRequestSchema>;

export const LiveStopSchema = z.object({ t: z.literal('live.stop'), sessionId: SessionIdSchema });
export type LiveStop = z.infer<typeof LiveStopSchema>;

// ---- student → server ----

/** The student app could not start the live view, or it ended on the student's side. */
export const LiveStateSchema = z.object({
  t: z.literal('live.state'),
  sessionId: SessionIdSchema,
  status: z.enum(['failed', 'ended']),
  reason: z.string().max(200).optional(),
});
export type LiveState = z.infer<typeof LiveStateSchema>;

// ---- teacher → server ----

export const LiveOpenSchema = z.object({
  t: z.literal('live.open'),
  examStudentId: z.string().min(1).max(100),
});
export type LiveOpen = z.infer<typeof LiveOpenSchema>;

export const LiveCloseSchema = z.object({ t: z.literal('live.close'), sessionId: SessionIdSchema });
export type LiveClose = z.infer<typeof LiveCloseSchema>;

// ---- server → teacher ----

export const LiveSessionStatusSchema = z.enum(['connecting', 'live', 'ended', 'failed']);
export type LiveSessionStatus = z.infer<typeof LiveSessionStatusSchema>;

/** Why the server refused or ended a live view (shown to the teacher). */
export const LiveEndReasonSchema = z.enum([
  'not_connected',
  'too_many',
  'student_failed',
  'student_left',
  'closed',
  'hosting_stopped',
]);
export type LiveEndReason = z.infer<typeof LiveEndReasonSchema>;

export const LiveSessionSchema = z.object({
  t: z.literal('live.session'),
  sessionId: SessionIdSchema,
  examStudentId: z.string().min(1).max(100),
  status: LiveSessionStatusSchema,
  reason: LiveEndReasonSchema.optional(),
});
export type LiveSession = z.infer<typeof LiveSessionSchema>;

// ---- student main ⇄ hidden live window (IPC, M34) ----

/** Main → live page: what to capture. */
export const LiveStartSchema = z.object({
  sessionId: SessionIdSchema,
  maxWidth: z.number().int().min(160).max(3840),
  fps: z.number().int().min(1).max(30),
});
export type LiveStart = z.infer<typeof LiveStartSchema>;

/** Live page → main: a signal for the teacher, or the end of the session on this side. */
export const LivePageMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('signal'), sessionId: SessionIdSchema, data: RtcSignalDataSchema }),
  z.object({
    kind: z.literal('state'),
    sessionId: SessionIdSchema,
    status: z.enum(['failed', 'ended']),
    reason: z.string().max(200).optional(),
  }),
]);
export type LivePageMessage = z.infer<typeof LivePageMessageSchema>;

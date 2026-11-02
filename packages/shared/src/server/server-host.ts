import { z } from 'zod';

/** Teacher UI listener: loopback only (docs/architecture.md §2). */
export const TEACHER_API_HOST = '127.0.0.1';
export const TEACHER_API_PORT = 47821;
export const TEACHER_TOKEN_HEADER = 'x-teacher-token';

/** Main → server, the first message on the parent port. */
export const ServerConfigMessageSchema = z.object({
  type: z.literal('config'),
  token: z.string().min(32),
  /** Profile userData folder; the database lives in `<dataDir>/db`. */
  dataDir: z.string().min(1),
  host: z.string().default(TEACHER_API_HOST),
  port: z.number().int().min(0).max(65535).default(TEACHER_API_PORT),
  /** Dev only (`EG_FAKE_GRADER=1`): grade with the built-in fake instead of Gemini (M38). */
  fakeGrader: z.boolean().default(false),
});
export type ServerConfigMessage = z.infer<typeof ServerConfigMessageSchema>;

/** Server → main. */
export const ServerReplyMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), port: z.number().int() }),
  z.object({ type: z.literal('error'), message: z.string() }),
  /** The student listener opened or closed; main blocks sleep while it is open. */
  z.object({ type: z.literal('hosting'), active: z.boolean() }),
  /** Grading is about to start (M38): main answers with `grading-key`. */
  z.object({ type: z.literal('grading-key-request'), requestId: z.number().int() }),
]);
export type ServerReplyMessage = z.infer<typeof ServerReplyMessageSchema>;

/**
 * Main → server after the config (M38): the teacher's Gemini key for one grading run, decrypted in
 * main and never written to the database or a log. `null` when no key is set.
 */
export const GradingKeyMessageSchema = z.object({
  type: z.literal('grading-key'),
  requestId: z.number().int(),
  apiKey: z.string().min(1).nullable(),
});
export type GradingKeyMessage = z.infer<typeof GradingKeyMessageSchema>;

export const ServerStateSchema = z.enum(['stopped', 'starting', 'running', 'restarting']);
export type ServerState = z.infer<typeof ServerStateSchema>;

/** Pushed from main to the renderer whenever the server process changes state. */
export const ServerStatusSchema = z.object({
  state: ServerStateSchema,
  restartCount: z.number().int().nonnegative(),
  lastRestartAt: z.number().int().nullable(),
});
export type ServerStatus = z.infer<typeof ServerStatusSchema>;

/** What the renderer needs to call the loopback API. */
export const ServerConnectionSchema = z.object({
  baseUrl: z.string(),
  token: z.string(),
});
export type ServerConnection = z.infer<typeof ServerConnectionSchema>;

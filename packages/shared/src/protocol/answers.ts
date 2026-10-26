import { z } from 'zod';

/**
 * Why a version was written. The final answers live in `final_answers` and point at a version,
 * so there is no reason for them (the DB CHECK in migration 0009 still allows `final`).
 */
export const SAVE_REASONS = [
  'interval',
  'run',
  'switch_question',
  'switch_language',
  'submit',
] as const;
export const SaveReasonSchema = z.enum(SAVE_REASONS);
export type SaveReason = z.infer<typeof SaveReasonSchema>;

/** Buffer key for written answers; code answers use the language id. */
export const ANSWER_TEXT_KEY = 'text';

/** Longest answer buffer a save may carry (characters); a frame is capped at 512 KB anyway. */
export const MAX_ANSWER_CHARS = 128 * 1024;
export const MAX_FLAGS_CHARS = 500;

/**
 * One version of one buffer, `(questionId, language)`. `clientSeq` is counted per student across
 * reconnects and the server keeps each once, so a resend is harmless. `selected` is true when
 * this language was the question's chosen one at the time.
 */
export const AnswerSaveSchema = z.object({
  t: z.literal('answer.save'),
  id: z.string().min(1).max(100),
  clientSeq: z.number().int().min(1),
  /** Server time as the client estimates it. */
  clientTs: z.number(),
  questionId: z.string().min(1).max(100),
  language: z.string().min(1).max(20),
  content: z.string().max(MAX_ANSWER_CHARS),
  selected: z.boolean(),
  reason: SaveReasonSchema,
  /** The student's own compiler or Node flags for this buffer (code questions). */
  flags: z.string().max(MAX_FLAGS_CHARS).optional(),
});
export type AnswerSave = z.infer<typeof AnswerSaveSchema>;

/** The save is stored, or was already, or was dropped as invalid: the client stops re-sending it. */
export const AnswerAckSchema = z.object({
  t: z.literal('answer.ack'),
  id: z.string(),
  clientSeq: z.number().int(),
});
export type AnswerAck = z.infer<typeof AnswerAckSchema>;

/** `welcome.state.saved`: the newest stored version of each buffer. */
export const SavedAnswerSchema = z.object({
  questionId: z.string(),
  language: z.string(),
  clientSeq: z.number().int(),
  selected: z.boolean(),
});
export type SavedAnswer = z.infer<typeof SavedAnswerSchema>;

// ---- student renderer → main (IPC) ----

/** What the renderer hands to main; main adds the id, the sequence number and the time. */
export const AnswerSaveRequestSchema = AnswerSaveSchema.pick({
  questionId: true,
  language: true,
  content: true,
  selected: true,
  reason: true,
  flags: true,
});
export type AnswerSaveRequest = z.infer<typeof AnswerSaveRequestSchema>;

/** Pushed to the renderer: how many saves still wait for the server, and when one was last acked. */
export const AnswerStatusSchema = z.object({
  pending: z.number().int().nonnegative(),
  lastAckAt: z.number().nullable(),
});
export type AnswerStatus = z.infer<typeof AnswerStatusSchema>;

// ---- resume after a restart ----

/** The newest stored version of one buffer, with its content. */
export const SnapshotBufferSchema = z.object({
  questionId: z.string(),
  language: z.string(),
  content: z.string(),
  flags: z.string().nullable(),
  clientSeq: z.number().int(),
});
export type SnapshotBuffer = z.infer<typeof SnapshotBufferSchema>;

/** The language a question was last saved as selected, and the `clientSeq` of that save. */
export const SnapshotSelectedSchema = z.object({
  questionId: z.string(),
  language: z.string(),
  clientSeq: z.number().int(),
});
export type SnapshotSelected = z.infer<typeof SnapshotSelectedSchema>;

/** `GET /api/v1/answers/latest` (student token): what the server holds for this student. */
export const AnswerSnapshotSchema = z.object({
  buffers: z.array(SnapshotBufferSchema),
  selected: z.array(SnapshotSelectedSchema),
});
export type AnswerSnapshot = z.infer<typeof AnswerSnapshotSchema>;

/** What main hands the renderer to refill its editors: server snapshot plus unacked local saves. */
export const RestoredAnswersSchema = z.object({
  buffers: z.array(
    z.object({
      questionId: z.string(),
      language: z.string(),
      content: z.string(),
      flags: z.string(),
    }),
  ),
  /** The language to show per code question. */
  languages: z.array(z.object({ questionId: z.string(), language: z.string() })),
});
export type RestoredAnswers = z.infer<typeof RestoredAnswersSchema>;

/** `answers:restore`: either the data, or a message to show with a Retry button. */
export const RestoreResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), answers: RestoredAnswersSchema }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type RestoreResult = z.infer<typeof RestoreResultSchema>;

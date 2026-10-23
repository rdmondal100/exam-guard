import { z } from 'zod';

/** One answer in a receipt: the language that counts and the SHA-256 (hex) of its content. */
export const ReceiptAnswerSchema = z.object({
  questionId: z.string().min(1),
  language: z.string().min(1).max(20),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ReceiptAnswer = z.infer<typeof ReceiptAnswerSchema>;

/** What the student keeps as proof of what was submitted (docs/protocol.md §3). */
export const ReceiptSchema = z.object({
  /** SHA-256 over the canonical JSON of `answers` (see `canonicalAnswers`). */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  submittedAt: z.number(),
  answers: z.array(ReceiptAnswerSchema),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/** Student asks to submit. Safe to send again: the server answers with the same receipt. */
export const SubmitSchema = z.object({
  t: z.literal('submit'),
  id: z.string().min(1).max(100),
  clientTs: z.number(),
});
export type Submit = z.infer<typeof SubmitSchema>;

export const SubmitResultSchema = z.object({
  t: z.literal('submit.result'),
  id: z.string(),
  receipt: ReceiptSchema,
});
export type SubmitResult = z.infer<typeof SubmitResultSchema>;

export const SUBMIT_REFUSALS = ['not_running', 'not_working'] as const;
export const SubmitRefusedSchema = z.object({
  t: z.literal('submit.refused'),
  id: z.string(),
  reason: z.enum(SUBMIT_REFUSALS),
});
export type SubmitRefused = z.infer<typeof SubmitRefusedSchema>;

/** The answers as submitted, with their content (used to build a receipt). */
export interface FinalAnswerInput {
  questionId: string;
  language: string;
  content: string;
}

/**
 * The text that is hashed: the answers sorted by question id, each reduced to
 * `{questionId, language, sha256}` with the keys in this fixed order.
 */
export function canonicalAnswers(answers: readonly ReceiptAnswer[]): string {
  const sorted = [...answers].sort((a, b) =>
    a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0,
  );
  return JSON.stringify(
    sorted.map(({ questionId, language, sha256 }) => ({ questionId, language, sha256 })),
  );
}

/**
 * Builds the receipt answers and hash. `sha256Hex` hashes UTF-8 text to lowercase hex; it is
 * passed in because this package also runs in the browser, where `node:crypto` does not exist.
 */
export function buildReceiptAnswers(
  inputs: readonly FinalAnswerInput[],
  sha256Hex: (text: string) => string,
): { hash: string; answers: ReceiptAnswer[] } {
  const answers = inputs
    .map((input) => ({
      questionId: input.questionId,
      language: input.language,
      sha256: sha256Hex(input.content),
    }))
    .sort((a, b) => (a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0));
  return { hash: sha256Hex(canonicalAnswers(answers)), answers };
}
